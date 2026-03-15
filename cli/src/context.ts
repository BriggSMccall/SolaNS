import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { fetchConfig, findConfigPda } from "@solans/client";

export type GlobalOpts = {
  cluster?: string;
  url?: string;
  ws?: string;
  keypair?: string;
  simulate?: boolean;
  yes?: boolean;
  json?: boolean;
};

export function clusterName(opts: GlobalOpts): string {
  return opts.cluster ?? process.env.SOLANS_CLUSTER ?? "devnet";
}

function resolveUrls(opts: GlobalOpts): { rpc: string; ws: string } {
  if (opts.url ?? process.env.SOLANS_RPC_URL) {
    const rpc = (opts.url ?? process.env.SOLANS_RPC_URL)!;
    const ws = opts.ws ?? process.env.SOLANS_WS_URL ?? rpc.replace(/^http/, "ws");
    return { rpc, ws };
  }
  switch (clusterName(opts)) {
    case "local":
    case "localnet":
      return { rpc: "http://127.0.0.1:8899", ws: "ws://127.0.0.1:8900" };
    case "devnet":
      return { rpc: "https://api.devnet.solana.com", ws: "wss://api.devnet.solana.com" };
    case "mainnet":
    case "mainnet-beta":
      return { rpc: "https://api.mainnet-beta.solana.com", ws: "wss://api.mainnet-beta.solana.com" };
    default:
      throw new Error(`Unknown cluster: ${clusterName(opts)}`);
  }
}

export async function loadSigner(opts: GlobalOpts): Promise<KeyPairSigner> {
  let path = opts.keypair ?? process.env.SOLANS_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
  if (path.startsWith("~/")) path = `${homedir()}/${path.slice(2)}`;
  const bytes = new Uint8Array(JSON.parse(readFileSync(path, "utf8")));
  return createKeyPairSignerFromBytes(bytes);
}

export type Ctx = {
  rpc: ReturnType<typeof createSolanaRpc>;
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
  signer: KeyPairSigner;
  opts: GlobalOpts;
};

export async function makeContext(opts: GlobalOpts): Promise<Ctx> {
  const { rpc: rpcUrl, ws } = resolveUrls(opts);
  return {
    rpc: createSolanaRpc(rpcUrl),
    rpcSubscriptions: createSolanaRpcSubscriptions(ws),
    signer: await loadSigner(opts),
    opts,
  };
}

/** Fetch the registry config account (throws if not yet initialized). */
export async function getConfig(ctx: Ctx) {
  const [configPda] = await findConfigPda();
  return fetchConfig(ctx.rpc, configPda);
}

/** Derive the payer's associated token account for a mint. */
export async function ataFor(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

/** Sign, simulate, and (unless --simulate) send + confirm a set of instructions. */
export async function sendInstructions(ctx: Ctx, instructions: readonly any[]): Promise<string | null> {
  const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(ctx.signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signedTx = await signTransactionMessageWithSigners(message);

  const sim = await ctx.rpc
    .simulateTransaction(getBase64EncodedWireTransaction(signedTx), { encoding: "base64" })
    .send();
  if (sim.value.err) {
    const errStr = JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    console.error("✗ simulation failed:", errStr);
    for (const line of sim.value.logs ?? []) console.error("   ", line);
    throw new Error("transaction simulation failed");
  }
  console.error(`  simulated OK (${sim.value.unitsConsumed ?? "?"} CU)`);
  if (ctx.opts.simulate) {
    console.error("  --simulate set: not sending.");
    return null;
  }

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc: ctx.rpc,
    rpcSubscriptions: ctx.rpcSubscriptions,
  });
  await sendAndConfirm(signedTx, { commitment: "confirmed" });
  return getSignatureFromTransaction(signedTx);
}

export function reportSig(ctx: Ctx, sig: string | null): void {
  if (!sig) return;
  console.log(`✓ ${sig}`);
  const c = clusterName(ctx.opts);
  if (c !== "local" && c !== "localnet") {
    const q = c === "mainnet" ? "mainnet-beta" : c;
    console.log(`  https://explorer.solana.com/tx/${sig}?cluster=${q}`);
  }
}
