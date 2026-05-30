// Dev helper: replay all SOLANS program txs from a localnet validator into the
// indexer's /webhook (stands in for the Helius webhook, which doesn't exist on localnet).
import { createSolanaRpc } from "@solana/kit";
const RPC = process.env.SOLANS_RPC_URL ?? "http://localhost:8899";
const INDEXER = process.env.INDEXER_URL ?? "http://localhost:8788";
const PROGRAM = "7pVCKp81EHJi2DbUtUXAkk2b3VtrUZwj2hWDakXY2dMf";
const rpc = createSolanaRpc(RPC);
const sigs = await rpc.getSignaturesForAddress(PROGRAM, { limit: 1000 }).send();
let count = 0;
for (const { signature } of [...sigs].reverse()) {
  const tx = await rpc.getTransaction(signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }).send();
  if (!tx) continue;
  const top = tx.transaction.message.instructions ?? [];
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions);
  const toIx = (i) => ({ programId: String(i.programId), accounts: (i.accounts ?? []).map(String), data: i.data });
  const instructions = [...top, ...inner].filter((i) => i.programId && i.data).map(toIx);
  const body = [{ signature, slot: Number(tx.slot), timestamp: Number(tx.blockTime ?? 0), instructions }];
  const res = await fetch(`${INDEXER}/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  count += j.indexed ?? 0;
}
console.log(`forwarded ${sigs.length} txs, ${count} SOLANS instructions indexed`);
