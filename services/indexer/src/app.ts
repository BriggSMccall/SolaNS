/**
 * SOLANS indexer HTTP service (§13). Ingests transactions from a **Helius webhook**
 * (raw or enhanced — both deliver per-instruction `programId` / `accounts` / base58
 * `data`), decodes the SOLANS instructions ({@link parseSolansInstruction}), folds
 * them into an injected {@link IndexStore}, and serves search / owner / watchlist
 * reads. The store is injected so routes are testable via `fastify.inject`; the live
 * Helius webhook registration is an external step (see the README).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { address, AccountRole, getBase58Encoder, type Address } from "@solana/kit";
import { CONTENT_TYPE as METRICS_CONTENT_TYPE, Registry } from "@solans/observability";
import { parseSolansInstruction, type IndexEvent, type RawInstruction } from "./parse.ts";
import { applyEvent, MemoryStore, type EventMeta, type IndexStore } from "./store.ts";

export { applyEvent, MemoryStore } from "./store.ts";
export type { IndexStore, NameEntry, EventMeta } from "./store.ts";
export { metasFromAddresses, parseSolansInstruction } from "./parse.ts";
export type { IndexEvent, RawInstruction } from "./parse.ts";

/** A Helius webhook instruction (raw or enhanced both expose these). */
interface HeliusInstruction {
  programId?: string;
  accounts?: string[];
  data?: string; // base58
  innerInstructions?: HeliusInstruction[];
}

/** A Helius webhook transaction (the fields the indexer reads). */
interface HeliusTx {
  signature?: string;
  slot?: number;
  timestamp?: number;
  instructions?: HeliusInstruction[];
}

const b58 = getBase58Encoder();

/** Flatten a Helius tx (top-level + inner instructions) to {@link RawInstruction}s. */
function rawInstructionsOf(tx: HeliusTx): RawInstruction[] {
  const out: RawInstruction[] = [];
  const walk = (ixs: HeliusInstruction[] | undefined) => {
    for (const ix of ixs ?? []) {
      if (ix.programId && ix.data) {
        out.push({
          programAddress: address(ix.programId),
          accounts: (ix.accounts ?? []).map((a) => ({ address: address(a) as Address, role: AccountRole.READONLY })),
          data: new Uint8Array(b58.encode(ix.data)),
        });
      }
      walk(ix.innerInstructions);
    }
  };
  walk(tx.instructions);
  return out;
}

/**
 * Decode + apply every SOLANS instruction in a batch of Helius txs. Returns the count
 * applied. `onApplied` (optional) fires per applied event — used for metrics.
 */
export async function ingestHeliusTxs(
  store: IndexStore,
  txs: HeliusTx[],
  onApplied?: (ev: IndexEvent) => void,
): Promise<number> {
  let applied = 0;
  for (const tx of txs) {
    const meta: EventMeta = { sig: tx.signature, slot: tx.slot, ts: tx.timestamp };
    for (const raw of rawInstructionsOf(tx)) {
      const ev = parseSolansInstruction(raw);
      if (ev) {
        await applyEvent(store, ev, meta);
        onApplied?.(ev);
        applied += 1;
      }
    }
  }
  return applied;
}

/**
 * Build the indexer HTTP app over an injected {@link IndexStore}. Routes:
 *  - `POST /webhook`         Helius tx batch -> decode + index ({ indexed })
 *  - `GET  /search?q=&limit` prefix search over indexed names
 *  - `GET  /owner/:pubkey`   names owned by a wallet
 *  - `GET  /name/:name`      a single name entry (404 if unknown)
 *  - `GET  /watchlist`       active full names (feeds the auto-renew keeper)
 *  - `GET  /health`
 */
export function buildApp(store: IndexStore = new MemoryStore()): FastifyInstance {
  const app = Fastify({ logger: false });

  // CORS: the browser marketplace (a different origin) reads /listings + /search.
  app.addHook("onRequest", async (req, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-headers", "content-type");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return reply.code(204).send();
  });

  // Observability (§13): indexed events by type, webhook batches, HTTP latency.
  const registry = new Registry();
  const httpRequests = registry.counter("solans_http_requests_total", "Indexer HTTP requests handled");
  const httpDuration = registry.histogram(
    "solans_http_request_duration_seconds",
    "Indexer HTTP request duration in seconds",
  );
  const indexEvents = registry.counter("solans_index_events_total", "Indexed SOLANS instructions by type");
  const webhookBatches = registry.counter("solans_webhook_batches_total", "Helius webhook batches received");

  app.addHook("onResponse", async (req, reply) => {
    const route = (req.routeOptions?.url ?? "unknown").split("?")[0];
    httpRequests.inc(1, { method: req.method, route, status: reply.statusCode });
    httpDuration.observe(reply.elapsedTime / 1000, { method: req.method, route });
  });

  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", METRICS_CONTENT_TYPE);
    return registry.expose();
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/webhook", async (req, reply) => {
    const body = req.body;
    const txs = (Array.isArray(body) ? body : [body]) as HeliusTx[];
    try {
      webhookBatches.inc();
      const indexed = await ingestHeliusTxs(store, txs, (ev) => indexEvents.inc(1, { type: ev.kind }));
      return { indexed };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get<{ Querystring: { q?: string; limit?: string } }>("/search", async (req, reply) => {
    const q = req.query.q;
    if (!q) return reply.code(400).send({ error: "missing ?q" });
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    return { results: await store.search(q, limit) };
  });

  app.get<{ Params: { pubkey: string } }>("/owner/:pubkey", async (req, reply) => {
    let owner: Address;
    try {
      owner = address(req.params.pubkey);
    } catch {
      return reply.code(400).send({ error: "invalid pubkey" });
    }
    return { names: await store.byOwner(owner) };
  });

  app.get<{ Params: { name: string } }>("/name/:name", async (req, reply) => {
    const entry = await store.getByName(req.params.name);
    if (!entry) return reply.code(404).send({ error: "not indexed" });
    return entry;
  });

  app.get("/watchlist", async () => ({ names: await store.watchlist() }));

  // Marketplace browse grid: currently-listed names with prices (§9.1).
  app.get("/listings", async () => ({ listings: await store.listings() }));

  return app;
}
