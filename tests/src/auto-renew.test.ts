import { describe, expect, it } from "vitest";
import { getApproveInstruction } from "@solana-program/token";
import { findConfigPda, getAutoRenewInstructionAsync, nameParts } from "@solans/client";
import {
  fundedSigner,
  logsOf,
  mintTokens,
  readDelegatedAmount,
  readName,
  readTokenAmount,
  registerName,
  send,
  sendExpectingFailure,
  setupEnv,
  warpToUnixTimestamp,
  type TestEnv,
} from "./harness.ts";

const YEAR = 31_536_000n;

/** Approve the Config PDA as delegate of `account` for `amount` (owner = env.payer). */
async function approve(env: TestEnv, account: string, amount: bigint) {
  const [config] = await findConfigPda();
  await send(env.svm, env.payer, [
    getApproveInstruction({ source: account as never, delegate: config, owner: env.payer, amount }),
  ]);
}

async function autoRenewIx(env: TestEnv, name: string, ownerTokenAccount: string, keeper: Awaited<ReturnType<typeof fundedSigner>>) {
  const { name: label, tld, hash } = nameParts(name);
  const { findNameRecordPda } = await import("@solans/client");
  const [nameRecord] = await findNameRecordPda({ nameHash: hash });
  return getAutoRenewInstructionAsync({
    keeper,
    nameRecord,
    ownerTokenAccount: ownerTokenAccount as never,
    treasuryTokenAccount: env.treasury,
    stakingVault: env.stakingVault,
    burnVault: env.burnVault,
    paymentMint: env.mint,
    name: label,
    tld,
    years: 1,
  });
}

describe("auto_renew (§6.2)", () => {
  it("a keeper charges the owner's delegated funds, splits 60/25/10/5, and extends a year", async () => {
    const env = await setupEnv();
    const pda = await registerName(env, "alpha"); // owner = env.payer
    await approve(env, env.payerAta, 10_000_000n); // 10 renewals' worth

    const expiresBefore = readName(env.svm, pda)!.expiresAt;
    warpToUnixTimestamp(env.svm, expiresBefore - 86_400n); // 1 day before expiry → inside the window

    const b = {
      payer: readTokenAmount(env.svm, env.payerAta)!,
      treasury: readTokenAmount(env.svm, env.treasury)!,
      staking: readTokenAmount(env.svm, env.stakingVault)!,
      burn: readTokenAmount(env.svm, env.burnVault)!,
    };
    const keeper = await fundedSigner(env.svm);
    await send(env.svm, keeper, [await autoRenewIx(env, "alpha", env.payerAta, keeper)]);

    // fee 1_000_000 (5+ char): treasury 700k (600 + 100 referral fold), staking 250k, burn 50k
    expect(b.payer - readTokenAmount(env.svm, env.payerAta)!).toBe(1_000_000n);
    expect(readTokenAmount(env.svm, env.treasury)! - b.treasury).toBe(700_000n);
    expect(readTokenAmount(env.svm, env.stakingVault)! - b.staking).toBe(250_000n);
    expect(readTokenAmount(env.svm, env.burnVault)! - b.burn).toBe(50_000n);
    expect(readName(env.svm, pda)!.expiresAt).toBe(expiresBefore + YEAR);
    // the delegation was consumed by the fee
    expect(readDelegatedAmount(env.svm, env.payerAta)).toBe(9_000_000n);
  });

  it("rejects renewing a name that is far from expiry (AutoRenewTooEarly)", async () => {
    const env = await setupEnv();
    await registerName(env, "alpha");
    await approve(env, env.payerAta, 10_000_000n);
    const keeper = await fundedSigner(env.svm);
    const res = await sendExpectingFailure(env.svm, keeper, [await autoRenewIx(env, "alpha", env.payerAta, keeper)]);
    expect(logsOf(res)).toContain("AutoRenewTooEarly");
  });

  it("rejects funding from an account that isn't the name owner's (NotOwner)", async () => {
    const env = await setupEnv();
    const pda = await registerName(env, "alpha");
    const other = await fundedSigner(env.svm);
    const otherAta = await mintTokens(env, env.mint, other.address, 5_000_000n);
    await approve(env, env.payerAta, 10_000_000n);
    warpToUnixTimestamp(env.svm, readName(env.svm, pda)!.expiresAt - 86_400n);
    const keeper = await fundedSigner(env.svm);
    const res = await sendExpectingFailure(env.svm, keeper, [await autoRenewIx(env, "alpha", otherAta, keeper)]);
    expect(logsOf(res)).toContain("NotOwner");
  });

  it("fails without a delegation (the Config PDA can't move the owner's tokens)", async () => {
    const env = await setupEnv();
    const pda = await registerName(env, "alpha");
    warpToUnixTimestamp(env.svm, readName(env.svm, pda)!.expiresAt - 86_400n);
    const keeper = await fundedSigner(env.svm);
    const res = await sendExpectingFailure(env.svm, keeper, [await autoRenewIx(env, "alpha", env.payerAta, keeper)]);
    expect(logsOf(res)).toContain("owner does not match");
  });
});
