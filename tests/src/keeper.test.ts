import { describe, expect, it } from "vitest";
import { address, unwrapOption } from "@solana/kit";
import { getApproveInstruction, getTokenDecoder } from "@solana-program/token";
import {
  findConfigPda,
  findNameRecordPda,
  getAutoRenewInstructionAsync,
  nameParts,
  priceForLabel,
  SolansClient,
  type Config,
} from "@solans/sdk";
import {
  dueForRenewal,
  processName,
  runOnce,
  WebhookNotifier,
  type Delegation,
  type KeeperEvent,
  type Notifier,
  type ProcessDeps,
} from "solans-keeper";
import {
  fundedSigner,
  readName,
  registerName,
  send,
  setupEnv,
  warpToUnixTimestamp,
  type TestEnv,
} from "./harness.ts";

const YEAR = 31_536_000n;
const WINDOW = 2_592_000n; // 30 days — RENEWAL_WINDOW_SECONDS
const NOTIFY_WINDOW = 5_184_000n; // 60 days
const CFG_PDA = address("11111111111111111111111111111111"); // arbitrary stand-in for unit tests

/** Records every event a notifier is handed, for assertions. */
function spyNotifier() {
  const events: KeeperEvent[] = [];
  const notifier: Notifier = { notify: async (e) => void events.push(e) };
  return { notifier, events };
}

/** A `ProcessDeps` with sensible no-op defaults; override per test. */
function deps(over: Partial<ProcessDeps>): ProcessDeps {
  return {
    resolve: async () => null,
    ownerDelegation: async () => null,
    quote: async () => 1_000_000n,
    renew: async () => "sig",
    notify: async () => {},
    configPda: CFG_PDA,
    now: 1_000n,
    windowSecs: WINDOW,
    notifyWindowSecs: NOTIFY_WINDOW,
    years: 1,
    ...over,
  };
}

const OWNER = address("2m5CoAk7ioZJbRYqHV9PJMNZN2gwpTPKQXR4GKyVifL7");
const record = (expiresAt: bigint) => ({ owner: OWNER, expiresAt }) as never;
const delegated = (amount: bigint): Delegation => ({ delegate: CFG_PDA, amount });

describe("keeper pure logic", () => {
  it("dueForRenewal: true inside the window (and past expiry), false outside", () => {
    expect(dueForRenewal(10_000n, 10_000n - WINDOW, WINDOW)).toBe(true); // exactly at the edge
    expect(dueForRenewal(10_000n, 10_000n - WINDOW + 1n, WINDOW)).toBe(true); // inside
    expect(dueForRenewal(10_000n, 10_000n - WINDOW - 1n, WINDOW)).toBe(false); // 1s too early
    expect(dueForRenewal(10_000n, 20_000n, WINDOW)).toBe(true); // already expired
  });

  it("priceForLabel mirrors the on-chain tiers (length / numeric / emoji 2×)", () => {
    const cfg = {
      price1: 100n,
      price2: 80n,
      price3: 60n,
      price4: 40n,
      price5plus: 10n,
      priceNumeric: 999n,
    } as Pick<Config, "price1" | "price2" | "price3" | "price4" | "price5plus" | "priceNumeric">;
    expect(priceForLabel(cfg, "a")).toBe(100n); // 1 char
    expect(priceForLabel(cfg, "alpha")).toBe(10n); // 5+ chars
    expect(priceForLabel(cfg, "12")).toBe(999n); // all-digit ≤4 → numeric premium
    expect(priceForLabel(cfg, "12345")).toBe(10n); // 5-digit → length tier, not numeric
    expect(priceForLabel(cfg, "a1")).toBe(80n); // not all-digit → length tier
    expect(priceForLabel(cfg, "🚀")).toBe(200n); // emoji: 1 code point → 2× price1
  });
});

describe("processName (branches)", () => {
  it("renews a due, sufficiently-delegated name and reports 'renewed' with the new expiry", async () => {
    const { notifier, events } = spyNotifier();
    const renewed: string[] = [];
    let resolves = 0;
    const result = await processName(
      "alex.chain",
      deps({
        now: 9_999_000n,
        resolve: async () => record(10_000_000n - (resolves++ === 0 ? 0n : -YEAR)), // 2nd resolve = extended
        ownerDelegation: async () => delegated(2_000_000n),
        quote: async () => 1_000_000n,
        renew: async (label, tld) => {
          renewed.push(`${label}.${tld}`);
          return "tx-sig";
        },
        notify: notifier.notify,
      }),
    );
    expect(result).toBe("renewed");
    expect(renewed).toEqual(["alex.chain"]); // parsed label + tld passed through
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "renewed", name: "alex.chain", signature: "tx-sig" });
  });

  it("nudges 'no-delegation' when due but the delegation is missing / too small / wrong delegate", async () => {
    for (const del of [null, delegated(500_000n), { delegate: OWNER, amount: 9n } as Delegation]) {
      const { notifier, events } = spyNotifier();
      let renewCalled = false;
      const result = await processName(
        "alex.chain",
        deps({
          now: 9_999_000n,
          resolve: async () => record(10_000_000n),
          ownerDelegation: async () => del,
          quote: async () => 1_000_000n,
          renew: async () => {
            renewCalled = true;
            return "x";
          },
          notify: notifier.notify,
        }),
      );
      expect(result).toBe("skipped");
      expect(renewCalled).toBe(false);
      expect(events[0]).toMatchObject({ type: "no-delegation", name: "alex.chain" });
    }
  });

  it("warns 'expiring-soon' inside the notify window but not yet the renewal window", async () => {
    const { notifier, events } = spyNotifier();
    const expiresAt = 10_000_000n;
    const result = await processName(
      "alex.chain",
      deps({
        now: expiresAt - WINDOW - 100n, // before renewal window…
        notifyWindowSecs: WINDOW + 1_000n, // …but inside notify window
        resolve: async () => record(expiresAt),
        notify: notifier.notify,
      }),
    );
    expect(result).toBe("skipped");
    expect(events[0]).toMatchObject({ type: "expiring-soon", name: "alex.chain" });
  });

  it("skips an unregistered name silently (no events)", async () => {
    const { notifier, events } = spyNotifier();
    const result = await processName("ghost.chain", deps({ resolve: async () => null, notify: notifier.notify }));
    expect(result).toBe("skipped");
    expect(events).toHaveLength(0);
  });

  it("reports 'renewal-failed' when the renew tx throws", async () => {
    const { notifier, events } = spyNotifier();
    const result = await processName(
      "alex.chain",
      deps({
        now: 9_999_000n,
        resolve: async () => record(10_000_000n),
        ownerDelegation: async () => delegated(2_000_000n),
        renew: async () => {
          throw new Error("blockhash expired");
        },
        notify: notifier.notify,
      }),
    );
    expect(result).toBe("failed");
    expect(events[0]).toMatchObject({ type: "renewal-failed", name: "alex.chain", error: "blockhash expired" });
  });

  it("runOnce tallies outcomes and survives a throwing lookup", async () => {
    const { notifier, events } = spyNotifier();
    const tally = await runOnce(
      ["due.chain", "early.chain", "boom.chain"],
      deps({
        now: 9_999_000n,
        resolve: async (n) => {
          if (n === "boom.chain") throw new Error("rpc down");
          return record(n === "due.chain" ? 10_000_000n : 10_000_000_000n);
        },
        ownerDelegation: async () => delegated(2_000_000n),
        notify: notifier.notify,
      }),
    );
    expect(tally).toEqual({ renewed: 1, skipped: 1, failed: 1 });
    expect(events.some((e) => e.type === "renewal-failed" && e.name === "boom.chain")).toBe(true);
  });
});

describe("WebhookNotifier", () => {
  it("POSTs the event as JSON with bigints stringified", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fakeFetch = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    await new WebhookNotifier("https://hook.example/notify", fakeFetch).notify({
      type: "renewed",
      name: "alex.chain",
      expiresAt: 1_900_000_000n,
      signature: "sig",
    });
    expect(calls[0].url).toBe("https://hook.example/notify");
    expect(calls[0].body).toEqual({ type: "renewed", name: "alex.chain", expiresAt: "1900000000", signature: "sig" });
  });
});

describe("keeper end-to-end against litesvm (§6.2)", () => {
  it("resolves, checks the delegation, and renews a near-expiry name on-chain", async () => {
    const env = await setupEnv();
    const pda = await registerName(env, "alpha"); // owner = env.payer, tld defaults to .sol
    const [config] = await findConfigPda();

    // Owner pre-approves the Config PDA to pull renewal fees (the §6.2 opt-in).
    await send(env.svm, env.payer, [
      getApproveInstruction({ source: env.payerAta as never, delegate: config, owner: env.payer, amount: 10_000_000n }),
    ]);

    const expiresBefore = readName(env.svm, pda)!.expiresAt;
    const now = expiresBefore - 86_400n; // 1 day before expiry → inside the renewal window
    warpToUnixTimestamp(env.svm, now);

    const client = SolansClient.fromFetcher((a) => Promise.resolve(env.svm.getAccount(a)));
    const keeper = await fundedSigner(env.svm);
    const { notifier, events } = spyNotifier();

    const result = await processName("alpha", {
      resolve: (n) => client.resolve(n),
      ownerDelegation: async () => {
        const acct = env.svm.getAccount(env.payerAta);
        if (!acct?.exists) return null;
        const t = getTokenDecoder().decode(acct.data);
        return { delegate: unwrapOption(t.delegate), amount: t.delegatedAmount };
      },
      quote: (label, years) => client.quoteName(label, years),
      renew: async (label, tld, years) => {
        const { hash } = nameParts(`${label}.${tld}`);
        const [nameRecord] = await findNameRecordPda({ nameHash: hash });
        const ix = await getAutoRenewInstructionAsync({
          keeper,
          nameRecord,
          ownerTokenAccount: env.payerAta,
          treasuryTokenAccount: env.treasury,
          stakingVault: env.stakingVault,
          burnVault: env.burnVault,
          paymentMint: env.mint,
          name: label,
          tld,
          years,
        });
        await send(env.svm, keeper, [ix]);
        return undefined;
      },
      notify: notifier.notify,
      configPda: config,
      now,
      windowSecs: WINDOW,
      notifyWindowSecs: NOTIFY_WINDOW,
      years: 1,
    });

    expect(result).toBe("renewed");
    expect(readName(env.svm, pda)!.expiresAt).toBe(expiresBefore + YEAR);
    expect(events[0]).toMatchObject({ type: "renewed", name: "alpha", expiresAt: expiresBefore + YEAR });
  });
});
