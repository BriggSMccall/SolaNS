/**
 * SOLANS keeper entrypoint: wires the pure {@link runOnce} loop (keeper.ts) to a
 * live RPC + signer and runs it on an interval. Permissionless — the keeper signs
 * `auto_renew` and pays only the tx fee; the renewal fee comes from the owner's
 * pre-approved delegation to the Config PDA.
 *
 * Env:
 *   SOLANS_RPC_URL       RPC endpoint (default devnet)
 *   SOLANS_WS_URL        WS endpoint (default: SOLANS_RPC_URL with http→ws)
 *   KEEPER_KEYPAIR       path to the keeper's keypair JSON (default ~/.config/solana/id.json)
 *   WATCHLIST_FILE       path to a JSON array of names to watch (e.g. ["alex.chain"])
 *   WATCHLIST            comma-separated names (merged with WATCHLIST_FILE)
 *   KEEPER_INTERVAL      seconds between sweeps (default 3600; 0 = run once and exit)
 *   KEEPER_YEARS         term to renew for (default 1)
 *   KEEPER_NOTIFY_WINDOW heads-up window in days for "expiring-soon" (default 60)
 *   NOTIFY_WEBHOOK_URL   optional webhook to POST events to (in addition to the console)
 *   KEEPER_METRICS_PORT  optional port for a Prometheus /metrics server (§13; 0/unset = off)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  fetchEncodedAccount,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  unwrapOption,
  type Address,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getTokenDecoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  decodeNameRecord,
  findConfigPda,
  findNameRecordPda,
  getAutoRenewInstructionAsync,
  nameParts,
  SolansClient,
} from "@solans/sdk";
import {
  ConsoleNotifier,
  MultiNotifier,
  runOnce,
  WebhookNotifier,
  type Delegation,
  type Notifier,
  type ProcessDeps,
} from "./keeper.ts";
import { buildKeeperMetrics, startMetricsServer } from "./metrics.ts";

const DAY = 86_400n;
const RENEWAL_WINDOW_SECONDS = 2_592_000n; // 30 days — must match constants.rs

function loadKeypairPath(): string {
  let path = process.env.KEEPER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
  if (path.startsWith("~/")) path = `${homedir()}/${path.slice(2)}`;
  return path;
}

function loadWatchlist(): string[] {
  const names = new Set<string>();
  if (process.env.WATCHLIST_FILE) {
    const parsed = JSON.parse(readFileSync(process.env.WATCHLIST_FILE, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("WATCHLIST_FILE must be a JSON array of names");
    for (const n of parsed) names.add(String(n).trim());
  }
  for (const n of (process.env.WATCHLIST ?? "").split(",")) {
    if (n.trim()) names.add(n.trim());
  }
  return [...names].filter(Boolean);
}

async function main() {
  const rpcUrl = process.env.SOLANS_RPC_URL ?? "https://api.devnet.solana.com";
  const wsUrl = process.env.SOLANS_WS_URL ?? rpcUrl.replace(/^http/, "ws");
  const intervalSecs = Number(process.env.KEEPER_INTERVAL ?? 3600);
  const years = Number(process.env.KEEPER_YEARS ?? 1);
  const notifyWindowSecs = BigInt(Number(process.env.KEEPER_NOTIFY_WINDOW ?? 60)) * DAY;

  const watchlist = loadWatchlist();
  if (watchlist.length === 0) {
    console.error("keeper: empty watchlist (set WATCHLIST_FILE or WATCHLIST). Nothing to do.");
    process.exit(1);
  }

  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const keeper = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(readFileSync(loadKeypairPath(), "utf8"))),
  );
  const client = SolansClient.fromRpc(rpc);
  const [configPda] = await findConfigPda();
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  const sinks: Notifier[] = [new ConsoleNotifier()];
  if (process.env.NOTIFY_WEBHOOK_URL) sinks.push(new WebhookNotifier(process.env.NOTIFY_WEBHOOK_URL));

  // Observability (§13): expose /metrics on KEEPER_METRICS_PORT (opt-in). The metrics
  // sink is just another Notifier folded into the MultiNotifier — keeper.ts stays pure.
  const metricsPort = Number(process.env.KEEPER_METRICS_PORT ?? 0);
  const metrics = metricsPort > 0 ? buildKeeperMetrics() : null;
  if (metrics) {
    sinks.push(metrics.notifier);
    startMetricsServer(metrics.registry, metricsPort);
    console.error(`keeper: metrics on http://0.0.0.0:${metricsPort}/metrics`);
  }
  const notifier = new MultiNotifier(sinks);

  console.error(
    `keeper: watching ${watchlist.length} name(s) on ${rpcUrl} as ${keeper.address}` +
      (intervalSecs > 0 ? `, every ${intervalSecs}s` : ", once"),
  );

  /** Read the owner's payment-account SPL delegation (which mint comes from Config). */
  async function ownerDelegation(owner: Address, paymentMint: Address): Promise<Delegation | null> {
    const [ata] = await findAssociatedTokenPda({ owner, mint: paymentMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const acct = await fetchEncodedAccount(rpc, ata);
    if (!acct.exists) return null;
    const token = getTokenDecoder().decode(acct.data);
    return { delegate: unwrapOption(token.delegate), amount: token.delegatedAmount };
  }

  async function renew(cfg: NonNullable<Awaited<ReturnType<typeof client.getConfig>>>, label: string, tld: string) {
    const { hash } = nameParts(`${label}.${tld}`);
    const [nameRecord] = await findNameRecordPda({ nameHash: hash });
    const ix = await getAutoRenewInstructionAsync({
      keeper,
      nameRecord,
      ownerTokenAccount: await ownerAta(cfg, nameRecord),
      treasuryTokenAccount: cfg.treasuryTokenAccount,
      stakingVault: cfg.stakingVault,
      burnVault: cfg.burnVault,
      paymentMint: cfg.paymentMint,
      name: label,
      tld,
      years,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(keeper, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([ix], m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], { commitment: "confirmed" });
    return getSignatureFromTransaction(signed);
  }

  /** The name owner's payment ATA (the account `auto_renew` debits via the delegation). */
  async function ownerAta(
    cfg: NonNullable<Awaited<ReturnType<typeof client.getConfig>>>,
    nameRecord: Address,
  ): Promise<Address> {
    const acct = await fetchEncodedAccount(rpc, nameRecord);
    if (!acct.exists) throw new Error("name record vanished");
    const owner = decodeNameRecord(acct).data.owner;
    const [ata] = await findAssociatedTokenPda({ owner, mint: cfg.paymentMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    return ata;
  }

  async function sweep() {
    const cfg = await client.getConfig();
    if (!cfg) {
      console.error("keeper: registry config not initialized; skipping sweep");
      return;
    }
    const deps: ProcessDeps = {
      resolve: (n) => client.resolve(n),
      ownerDelegation: (owner) => ownerDelegation(owner, cfg.paymentMint),
      quote: (label, y) => client.quoteName(label, y),
      renew: (label, tld) => renew(cfg, label, tld),
      notify: (e) => notifier.notify(e),
      configPda,
      now: BigInt(Math.floor(Date.now() / 1000)),
      windowSecs: RENEWAL_WINDOW_SECONDS,
      notifyWindowSecs,
      years,
    };
    const tally = await runOnce(watchlist, deps);
    metrics?.sweeps.inc();
    console.error(`keeper: sweep done — renewed ${tally.renewed}, skipped ${tally.skipped}, failed ${tally.failed}`);
  }

  await sweep();
  if (intervalSecs > 0) setInterval(() => void sweep(), intervalSecs * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
