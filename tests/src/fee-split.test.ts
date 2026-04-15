import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSigner, type Address } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  findConfigPda,
  findNameRecordPda,
  getClaimExpiredInstructionAsync,
  getRenewNameInstructionAsync,
  getUpdateConfigInstructionAsync,
  nameInfo,
} from "@solans/client";
import {
  fundedSigner,
  logsOf,
  mintTokensTo,
  readConfig,
  readName,
  readTokenAmount,
  registerName,
  send,
  sendExpectingFailure,
  setupEnv,
  warpToUnixTimestamp,
  type TestEnv,
} from "./harness.ts";

/** A fresh 0-balance token account (payment mint) to receive a referral share. */
async function makeReferrer(env: TestEnv): Promise<Address> {
  const owner = await generateKeyPairSigner();
  const [ata] = await findAssociatedTokenPda({ owner: owner.address, mint: env.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  await send(env.svm, env.payer, [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: env.payer, owner: owner.address, mint: env.mint }),
  ]);
  return ata;
}

/** Build an update_config that preserves every field except `over`. */
async function updateConfigIx(env: TestEnv, over: Record<string, unknown>) {
  const [cfgPda] = await findConfigPda();
  const d = readConfig(env.svm, cfgPda)!;
  return getUpdateConfigInstructionAsync({
    admin: env.payer,
    price1: d.price1,
    price2: d.price2,
    price3: d.price3,
    price4: d.price4,
    price5plus: d.price5plus,
    priceNumeric: d.priceNumeric,
    gracePeriodSeconds: d.gracePeriodSeconds,
    minYears: d.minYears,
    maxYears: d.maxYears,
    solTreasury: d.solTreasury,
    marketplaceFeeBps: d.marketplaceFeeBps,
    stakingFeeBps: d.stakingFeeBps,
    referralFeeBps: d.referralFeeBps,
    burnFeeBps: d.burnFeeBps,
    ...over,
  });
}

describe("protocol fee-split (§8.2)", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupEnv();
  });

  it("registration with a referrer splits the fee 60 / 25 / 10 / 5", async () => {
    const referral = await makeReferrer(env);
    const t0 = readTokenAmount(env.svm, env.treasury)!;
    const s0 = readTokenAmount(env.svm, env.stakingVault)!;
    const b0 = readTokenAmount(env.svm, env.burnVault)!;

    await registerName(env, "abcdef", { referral }); // fee = 1_000_000

    expect(readTokenAmount(env.svm, env.treasury)! - t0).toBe(600_000n); // 60%
    expect(readTokenAmount(env.svm, env.stakingVault)! - s0).toBe(250_000n); // 25%
    expect(readTokenAmount(env.svm, referral)!).toBe(100_000n); // 10%
    expect(readTokenAmount(env.svm, env.burnVault)! - b0).toBe(50_000n); // 5%
  });

  it("registration without a referrer folds the referral share into treasury (70%)", async () => {
    const t0 = readTokenAmount(env.svm, env.treasury)!;
    const s0 = readTokenAmount(env.svm, env.stakingVault)!;
    const b0 = readTokenAmount(env.svm, env.burnVault)!;

    await registerName(env, "ghijkl");

    expect(readTokenAmount(env.svm, env.treasury)! - t0).toBe(700_000n); // 60 + 10
    expect(readTokenAmount(env.svm, env.stakingVault)! - s0).toBe(250_000n);
    expect(readTokenAmount(env.svm, env.burnVault)! - b0).toBe(50_000n);
  });

  it("renewal splits the fee and now applies the numeric premium", async () => {
    await registerName(env, "12"); // numeric, fee = price_numeric (500M)
    const [nameRecord] = await findNameRecordPda({ nameHash: nameInfo("12").hash });
    const t0 = readTokenAmount(env.svm, env.treasury)!;
    const s0 = readTokenAmount(env.svm, env.stakingVault)!;

    await send(env.svm, env.payer, [
      await getRenewNameInstructionAsync({
        payer: env.payer,
        nameRecord,
        payerTokenAccount: env.payerAta,
        treasuryTokenAccount: env.treasury,
        stakingVault: env.stakingVault,
        burnVault: env.burnVault,
        paymentMint: env.mint,
        name: "12",
        tld: "sol",
        years: 1,
      }),
    ]);

    // renew uses price_for_label now → the numeric premium (500M). No referrer,
    // so treasury gets 70% (60 + 10) and stakers 25%.
    expect(readTokenAmount(env.svm, env.stakingVault)! - s0).toBe(125_000_000n); // 25% of 500M
    expect(readTokenAmount(env.svm, env.treasury)! - t0).toBe(350_000_000n); // 70% of 500M
  });

  it("claim splits the fee too", async () => {
    const env2 = await setupEnv({ gracePeriodSeconds: 0n });
    const pda = await registerName(env2, "claimme");
    warpToUnixTimestamp(env2.svm, readName(env2.svm, pda)!.expiresAt + 10n);
    const claimer = await fundedSigner(env2.svm);
    const ata = await mintTokensTo(env2, claimer.address, 1_000_000_000_000n);

    const t0 = readTokenAmount(env2.svm, env2.treasury)!;
    const s0 = readTokenAmount(env2.svm, env2.stakingVault)!;
    await send(env2.svm, claimer, [
      await getClaimExpiredInstructionAsync({
        claimer,
        nameRecord: pda,
        payerTokenAccount: ata,
        treasuryTokenAccount: env2.treasury,
        stakingVault: env2.stakingVault,
        burnVault: env2.burnVault,
        paymentMint: env2.mint,
        name: "claimme",
        tld: "sol",
        years: 1,
      }),
    ]);
    expect(readTokenAmount(env2.svm, env2.treasury)! - t0).toBe(700_000n); // 60 + 10 (no referrer)
    expect(readTokenAmount(env2.svm, env2.stakingVault)! - s0).toBe(250_000n);
  });

  it("treasury absorbs rounding dust (the four shares sum to the exact fee)", async () => {
    await send(env.svm, env.payer, [await updateConfigIx(env, { price5plus: 1_000_003n })]);
    const referral = await makeReferrer(env);
    const t0 = readTokenAmount(env.svm, env.treasury)!;
    const s0 = readTokenAmount(env.svm, env.stakingVault)!;
    const b0 = readTokenAmount(env.svm, env.burnVault)!;

    await registerName(env, "dustname", { referral }); // 8 chars → fee 1_000_003

    const treasuryD = readTokenAmount(env.svm, env.treasury)! - t0;
    const stakingD = readTokenAmount(env.svm, env.stakingVault)! - s0;
    const referralD = readTokenAmount(env.svm, referral)!;
    const burnD = readTokenAmount(env.svm, env.burnVault)! - b0;

    expect(stakingD).toBe(250_000n); // floor(1_000_003 * 0.25)
    expect(referralD).toBe(100_000n);
    expect(burnD).toBe(50_000n);
    expect(treasuryD).toBe(600_003n); // absorbs the +3 remainder
    expect(treasuryD + stakingD + referralD + burnD).toBe(1_000_003n); // exact
  });

  it("rejects a fee-split whose bps sum to >= 10000 (InvalidFeeSplit)", async () => {
    const res = await sendExpectingFailure(env.svm, env.payer, [
      await updateConfigIx(env, { stakingFeeBps: 9000, referralFeeBps: 1000, burnFeeBps: 0 }), // sum = 10000
    ]);
    expect(logsOf(res)).toContain("InvalidFeeSplit");
  });
});
