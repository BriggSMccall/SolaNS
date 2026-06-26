// Persistent incremental forwarder: replays SOLANS program txs into the indexer's
// /webhook (stands in for the Helius webhook). Unlike forward-localnet.mjs (one-shot,
// re-fetches everything), this backfills once on start then polls only *new*
// signatures — so it never hammers a rate-limited public RPC (devnet 429s otherwise).
import { createSolanaRpc } from "@solana/kit";

const RPC = process.env.SOLANS_RPC_URL ?? "http://localhost:8899";
const INDEXER = process.env.INDEXER_URL ?? "http://localhost:8788";
const PROGRAM = process.env.SOLANS_PROGRAM_ID ?? "7pVCKp81EHJi2DbUtUXAkk2b3VtrUZwj2hWDakXY2dMf";
const POLL_MS = Number(process.env.POLL_MS ?? 8000);
const BACKFILL = Number(process.env.BACKFILL ?? 400);
const POLL_LIMIT = Number(process.env.POLL_LIMIT ?? 50);

const rpc = createSolanaRpc(RPC);
const seen = new Set();

async function forwardSig(signature) {
  const tx = await rpc
    .getTransaction(signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 })
    .send();
  if (!tx) return 0;
  const top = tx.transaction.message.instructions ?? [];
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions);
  const toIx = (i) => ({ programId: String(i.programId), accounts: (i.accounts ?? []).map(String), data: i.data });
  const instructions = [...top, ...inner].filter((i) => i.programId && i.data).map(toIx);
  const body = [{ signature, slot: Number(tx.slot), timestamp: Number(tx.blockTime ?? 0), instructions }];
  const res = await fetch(`${INDEXER}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  return j.indexed ?? 0;
}

// One sweep: fetch the latest `limit` signatures, forward only the unseen ones
// (oldest first, so a parent name is indexed before its subdomains).
async function tick(limit) {
  const sigs = await rpc.getSignaturesForAddress(PROGRAM, { limit }).send();
  const fresh = [...sigs].reverse().filter((s) => !s.err && !seen.has(s.signature));
  let indexed = 0;
  for (const s of fresh) {
    try {
      indexed += await forwardSig(s.signature);
      seen.add(s.signature); // only mark seen on success → failures retry next tick
    } catch {
      /* transient RPC error: leave unseen, retry next tick */
    }
  }
  return { scanned: sigs.length, fresh: fresh.length, indexed };
}

console.log(`[forwarder] rpc=${RPC} indexer=${INDEXER} backfill=${BACKFILL} poll=${POLL_MS}ms`);
try {
  console.log(`[forwarder] backfill ${JSON.stringify(await tick(BACKFILL))}`);
} catch (e) {
  console.error("[forwarder] backfill error:", e.message);
}
setInterval(async () => {
  try {
    const r = await tick(POLL_LIMIT);
    if (r.fresh) console.log(`[forwarder] ${JSON.stringify(r)}`);
  } catch (e) {
    console.error("[forwarder] tick error:", e.message);
  }
}, POLL_MS);
