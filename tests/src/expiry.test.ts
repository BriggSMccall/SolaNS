import { describe, expect, it } from "vitest";
import { getClaimExpiredInstructionAsync, getRenewNameInstructionAsync } from "@solans/client";
import {
  fundedSigner,
  logsOf,
  mintTokensTo,
  readName,
  registerName,
  send,
  sendExpectingFailure,
  setupEnv,
  warpToUnixTimestamp,
} from "./harness.ts";

describe("expiry / claim_expired / renew", () => {
  it("cannot claim a name that is not past expiry + grace", async () => {
    const env = await setupEnv({ gracePeriodSeconds: 100n });
    const pda = await registerName(env, "fresh");
    const claimer = await fundedSigner(env.svm);
    const ata = await mintTokensTo(env, claimer.address, 1_000_000_000n);

    const res = await sendExpectingFailure(env.svm, claimer, [
      await getClaimExpiredInstructionAsync({
        claimer,
        nameRecord: pda,
        payerTokenAccount: ata,
        treasuryTokenAccount: env.treasury,
        paymentMint: env.mint,
        name: "fresh",
        tld: "sol",
        years: 1,
      }),
    ]);
    expect(logsOf(res)).toContain("NotExpired");
  });

  it("can claim once past expiry + grace, resetting ownership", async () => {
    const env = await setupEnv({ gracePeriodSeconds: 100n });
    const pda = await registerName(env, "lapsed");
    const before = readName(env.svm, pda)!;

    warpToUnixTimestamp(env.svm, before.expiresAt + 100n + 10n);

    const claimer = await fundedSigner(env.svm);
    const ata = await mintTokensTo(env, claimer.address, 1_000_000_000n);
    await send(env.svm, claimer, [
      await getClaimExpiredInstructionAsync({
        claimer,
        nameRecord: pda,
        payerTokenAccount: ata,
        treasuryTokenAccount: env.treasury,
        paymentMint: env.mint,
        name: "lapsed",
        tld: "sol",
        years: 1,
      }),
    ]);

    const after = readName(env.svm, pda)!;
    expect(after.owner).toBe(claimer.address);
    expect(after.owner).not.toBe(before.owner);
    expect(after.expiresAt).toBeGreaterThan(before.expiresAt);
    expect(after.records.length).toBe(0);
  });

  it("renew extends the expiry", async () => {
    const env = await setupEnv();
    const pda = await registerName(env, "renewme", { years: 1 });
    const before = readName(env.svm, pda)!;
    await send(env.svm, env.payer, [
      await getRenewNameInstructionAsync({
        payer: env.payer,
        nameRecord: pda,
        payerTokenAccount: env.payerAta,
        treasuryTokenAccount: env.treasury,
        paymentMint: env.mint,
        name: "renewme",
        tld: "sol",
        years: 2,
      }),
    ]);
    expect(readName(env.svm, pda)!.expiresAt).toBeGreaterThan(before.expiresAt);
  });
});
