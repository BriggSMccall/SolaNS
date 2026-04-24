import Fastify, { type FastifyInstance } from "fastify";
import { address, unwrapOption, type Address } from "@solana/kit";
import {
  DEFAULT_GATEWAYS,
  hostingUrl,
  parseName,
  type Gateways,
  type NameRecord,
  type Record as SolansRecord,
} from "@solans/sdk";

/** The read surface the service needs; `SolansClient` satisfies this. */
export interface Resolver {
  resolve(name: string): Promise<NameRecord | null>;
  reverseLookup(owner: Address): Promise<string | null>;
  getRecords(name: string): Promise<SolansRecord[]>;
  /** The name's hosted-content reference (`hosting_ref` / `content` / `url`), or null. */
  contentRef(name: string): Promise<string | null>;
}

/** Fetches upstream gateway content; injected so the `/site` route is testable. */
export type ContentFetcher = (
  url: string,
) => Promise<{ status: number; contentType: string | null; body: Uint8Array }>;

export interface BuildOpts {
  /** Override the upstream fetch (default: global `fetch`). */
  fetchContent?: ContentFetcher;
  /** IPFS/Arweave gateway bases (default: ipfs.io / arweave.net). */
  gateways?: Gateways;
}

const defaultFetchContent: ContentFetcher = async (url) => {
  const res = await fetch(url);
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    body: new Uint8Array(await res.arrayBuffer()),
  };
};

function serialize(input: string, d: NameRecord) {
  const { name, tld } = parseName(input);
  return {
    name: `${name}.${tld}`,
    owner: d.owner,
    controller: unwrapOption(d.controller),
    expiresAt: new Date(Number(d.expiresAt) * 1000).toISOString(),
    transferLocked: d.transferLocked,
    reverseSet: d.reverseSet,
    resolver: unwrapOption(d.resolver),
    hostingRef: unwrapOption(d.hostingRef),
    nftMint: unwrapOption(d.nftMint),
    tokenized: unwrapOption(d.nftMint) !== null,
    listed: d.listed,
    records: d.records.map((r) => ({ key: r.key, value: r.value })),
  };
}

/**
 * Build the resolver HTTP app over an injected {@link Resolver}. Routes:
 *  - `GET /health`
 *  - `GET /resolve/:name`  -> name record JSON (404 if unregistered)
 *  - `GET /reverse/:pubkey` -> { pubkey, name } (404 if none/stale)
 *  - `GET /dns-query?name=&type=` -> DoH (JSON variant, application/dns-json);
 *    TXT answers carry the name's `key=value` records. Binary RFC-8484 wire
 *    format is a follow-up.
 *  - `GET /site/:name[/*path]` -> proxy the name's hosted content (§6) from its
 *    IPFS/Arweave gateway (404 no content, 422 unsupported ref, 502 upstream fail).
 */
export function buildApp(resolver: Resolver, opts: BuildOpts = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const fetchContent = opts.fetchContent ?? defaultFetchContent;
  const gateways = opts.gateways ?? DEFAULT_GATEWAYS;

  app.get("/health", async () => ({ ok: true }));

  app.get<{ Params: { name: string } }>("/resolve/:name", async (req, reply) => {
    let rec: NameRecord | null;
    try {
      rec = await resolver.resolve(req.params.name);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    if (!rec) return reply.code(404).send({ error: "not registered" });
    return serialize(req.params.name, rec);
  });

  app.get<{ Params: { pubkey: string } }>("/reverse/:pubkey", async (req, reply) => {
    let name: string | null;
    try {
      name = await resolver.reverseLookup(address(req.params.pubkey));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    if (!name) return reply.code(404).send({ error: "no reverse record" });
    return { pubkey: req.params.pubkey, name };
  });

  app.get<{ Querystring: { name?: string; type?: string } }>("/dns-query", async (req, reply) => {
    const name = req.query.name;
    if (!name) return reply.code(400).send({ error: "missing ?name" });
    const type = (req.query.type ?? "TXT").toUpperCase();
    let records: SolansRecord[];
    try {
      records = await resolver.getRecords(name);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const answer = type === "TXT" ? records.map((r) => ({ name, type: 16, TTL: 60, data: `${r.key}=${r.value}` })) : [];
    reply.header("content-type", "application/dns-json");
    // DNS RCODEs: 0 = NOERROR, 3 = NXDOMAIN
    return { Status: records.length === 0 ? 3 : 0, Question: [{ name, type }], Answer: answer };
  });

  // Serve a name's hosted website (§6): resolve its content ref, then proxy the
  // upstream IPFS/Arweave gateway (sub-path forwarded for a static site's assets).
  async function serveSite(name: string, subPath: string, reply: import("fastify").FastifyReply) {
    let ref: string | null;
    try {
      ref = await resolver.contentRef(name);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    if (!ref) return reply.code(404).send({ error: "no hosted content" });
    const url = hostingUrl(ref, subPath, gateways);
    if (!url) return reply.code(422).send({ error: `unsupported content ref: ${ref}` });
    try {
      const res = await fetchContent(url);
      reply.code(res.status);
      if (res.contentType) reply.header("content-type", res.contentType);
      return reply.send(Buffer.from(res.body));
    } catch {
      return reply.code(502).send({ error: "upstream gateway fetch failed" });
    }
  }

  app.get<{ Params: { name: string } }>("/site/:name", (req, reply) => serveSite(req.params.name, "", reply));
  app.get<{ Params: { name: string; "*": string } }>("/site/:name/*", (req, reply) =>
    serveSite(req.params.name, req.params["*"], reply),
  );

  return app;
}
