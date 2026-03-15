import { describe, expect, it } from "vitest";
import { findConfigPda, getUpdateConfigInstructionAsync } from "@solans/client";
import { fundedSigner, logsOf, readConfig, send, sendExpectingFailure, setupEnv } from "./harness.ts";

describe("init_config / update_config", () => {
  it("records the admin and economic params at init", async () => {
    const env = await setupEnv({ gracePeriodSeconds: 7_776_000n });
    const [cfgPda] = await findConfigPda();
    const cfg = readConfig(env.svm, cfgPda)!;
    expect(cfg.admin).toBe(env.payer.address);
    expect(cfg.treasuryTokenAccount).toBe(env.treasury);
    expect(cfg.paymentMint).toBe(env.mint);
    expect(cfg.gracePeriodSeconds).toBe(7_776_000n);
  });

  it("lets the admin update params, but rejects a non-admin (NotAdmin)", async () => {
    const env = await setupEnv();
    const [cfgPda] = await findConfigPda();
    const before = readConfig(env.svm, cfgPda)!;

    await send(env.svm, env.payer, [
      await getUpdateConfigInstructionAsync({
        admin: env.payer,
        price1: before.price1,
        price2: before.price2,
        price3: before.price3,
        price4: before.price4,
        price5plus: 42n,
        gracePeriodSeconds: 123n,
        minYears: 1,
        maxYears: 5,
      }),
    ]);
    const after = readConfig(env.svm, cfgPda)!;
    expect(after.price5plus).toBe(42n);
    expect(after.gracePeriodSeconds).toBe(123n);
    expect(after.maxYears).toBe(5);

    const stranger = await fundedSigner(env.svm);
    const res = await sendExpectingFailure(env.svm, stranger, [
      await getUpdateConfigInstructionAsync({
        admin: stranger,
        price1: 1n,
        price2: 1n,
        price3: 1n,
        price4: 1n,
        price5plus: 1n,
        gracePeriodSeconds: 0n,
        minYears: 1,
        maxYears: 1,
      }),
    ]);
    expect(logsOf(res)).toContain("NotAdmin");
  });
});
