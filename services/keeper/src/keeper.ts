/**
 * SOLANS auto-renew + notification keeper (Technical Concept §6.2).
 *
 * The on-chain `auto_renew` instruction lets a permissionless keeper charge a
 * name's renewal fee from the **owner's pre-approved SPL delegation** to the
 * Config PDA — but nothing on-chain *triggers* it. This module is that trigger:
 * for each watched name it resolves the record and, if the name is within the
 * renewal window **and** the owner delegates ≥ the fee to the Config PDA, it
 * renews; otherwise it emits a lifecycle notification.
 *
 * **Watchlist-driven, not scan-driven.** A `NameRecord` stores the name *hash*,
 * not the plaintext label, and `auto_renew(name, tld, years)` re-derives
 * `keccak256(name.tld)` — so a blind `getProgramAccounts` scan can't recover the
 * labels. The keeper takes an explicit list of names (a config file today; an
 * indexer that logs labels from registration events can feed it later).
 *
 * All on-chain effects are **injected** ({@link ProcessDeps}), so the decision
 * logic here is transport-free and unit/litesvm-testable; `index.ts` wires the
 * real SDK + RPC + signer.
 */
import type { Address } from "@solana/kit";
import { parseName, type NameRecord } from "@solans/sdk";

/** A name lifecycle event for notification (§6.2 "Telegram/Push"). */
export type KeeperEvent =
  | { type: "renewed"; name: string; expiresAt: bigint; signature?: string }
  | { type: "renewal-failed"; name: string; error: string }
  | { type: "no-delegation"; name: string; expiresAt: bigint }
  | { type: "expiring-soon"; name: string; expiresAt: bigint };

/** A sink for {@link KeeperEvent}s. Telegram/Dialect are adapters of this interface. */
export interface Notifier {
  notify(event: KeeperEvent): Promise<void>;
}

function describe(e: KeeperEvent): string {
  const when = "expiresAt" in e ? ` (expires ${new Date(Number(e.expiresAt) * 1000).toISOString()})` : "";
  const why = "error" in e ? `: ${e.error}` : "signature" in e && e.signature ? ` [${e.signature}]` : "";
  return `${e.type} ${e.name}${when}${why}`;
}

/** Logs each event to stdout — the default sink. */
export class ConsoleNotifier implements Notifier {
  async notify(e: KeeperEvent): Promise<void> {
    console.log(`[keeper] ${describe(e)}`);
  }
}

/** POSTs each event as JSON to a webhook (bigints stringified). */
export class WebhookNotifier implements Notifier {
  constructor(
    private readonly url: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}
  async notify(e: KeeperEvent): Promise<void> {
    const body = JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    await this.fetchFn(this.url, { method: "POST", headers: { "content-type": "application/json" }, body });
  }
}

/** Fans an event out to several notifiers; one failing doesn't stop the rest. */
export class MultiNotifier implements Notifier {
  constructor(private readonly sinks: Notifier[]) {}
  async notify(e: KeeperEvent): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => s.notify(e)));
  }
}

/** True once `now` is within `windowSecs` of (or past) `expiresAt`. */
export function dueForRenewal(expiresAt: bigint, now: bigint, windowSecs: bigint): boolean {
  return now >= expiresAt - windowSecs;
}

/** The SPL delegation on the owner's payment account funding an auto-renew. */
export interface Delegation {
  delegate: Address | null;
  amount: bigint;
}

/** Injected on-chain effects + tuning for {@link processName}. */
export interface ProcessDeps {
  /** Resolve a name → its record (validates the subdomain parent chain), or null. */
  resolve(name: string): Promise<NameRecord | null>;
  /** The owner's payment-account delegation, or null if it has none. */
  ownerDelegation(owner: Address): Promise<Delegation | null>;
  /** Annual fee × years for a bare label (mirrors `SolansClient.quoteName`). */
  quote(label: string, years: number): Promise<bigint>;
  /** Build + send `auto_renew`; resolves to the tx signature (or undefined). */
  renew(label: string, tld: string, years: number): Promise<string | undefined>;
  notify(event: KeeperEvent): Promise<void>;
  /** The Config PDA — the only delegate `auto_renew` accepts. */
  configPda: Address;
  /** Current unix time (seconds). */
  now: bigint;
  /** Renewal window (seconds before expiry) — must equal `RENEWAL_WINDOW_SECONDS` on-chain. */
  windowSecs: bigint;
  /** Wider "heads-up" window: warn an owner whose name nears expiry but isn't auto-renewable yet. */
  notifyWindowSecs: bigint;
  /** Term to renew for. */
  years: number;
}

export type ProcessResult = "renewed" | "skipped" | "failed";

/**
 * Process one watched name: resolve → (in renewal window?) → (delegation covers
 * the fee?) → renew, emitting a notification on every branch that an owner would
 * care about. Pure decision logic over {@link ProcessDeps}; never throws (effect
 * errors become a `renewal-failed` event + `"failed"`).
 */
export async function processName(name: string, deps: ProcessDeps): Promise<ProcessResult> {
  const rec = await deps.resolve(name);
  if (!rec) return "skipped"; // unregistered, or an orphaned subdomain subtree

  const { name: label, tld } = parseName(name);
  const expiresAt = rec.expiresAt;

  if (!dueForRenewal(expiresAt, deps.now, deps.windowSecs)) {
    // Not in the renewal window yet — but warn if it's inside the wider notify window.
    if (dueForRenewal(expiresAt, deps.now, deps.notifyWindowSecs)) {
      await deps.notify({ type: "expiring-soon", name, expiresAt });
    }
    return "skipped";
  }

  // Due: it needs a Config-PDA delegation covering the fee, else nudge the owner.
  const fee = await deps.quote(label, deps.years);
  const del = await deps.ownerDelegation(rec.owner);
  if (!del || del.delegate !== deps.configPda || del.amount < fee) {
    await deps.notify({ type: "no-delegation", name, expiresAt });
    return "skipped";
  }

  try {
    const signature = await deps.renew(label, tld, deps.years);
    const after = await deps.resolve(name);
    await deps.notify({ type: "renewed", name, expiresAt: after?.expiresAt ?? expiresAt, signature });
    return "renewed";
  } catch (err) {
    await deps.notify({ type: "renewal-failed", name, error: (err as Error).message });
    return "failed";
  }
}

/** Process every watched name once, tallying outcomes. Resilient: a lookup that throws counts as failed. */
export async function runOnce(watchlist: string[], deps: ProcessDeps): Promise<Record<ProcessResult, number>> {
  const tally: Record<ProcessResult, number> = { renewed: 0, skipped: 0, failed: 0 };
  for (const name of watchlist) {
    try {
      tally[await processName(name, deps)] += 1;
    } catch (err) {
      // resolve/quote/delegation lookups can throw on RPC failure — record + keep going.
      tally.failed += 1;
      await deps.notify({ type: "renewal-failed", name, error: (err as Error).message });
    }
  }
  return tally;
}
