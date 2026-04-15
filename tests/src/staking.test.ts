import { describe, expect, it } from "vitest";
import type { Address, KeyPairSigner } from "@solana/kit";
import {
  getClaimRewardsInstructionAsync,
  getStakeInstructionAsync,
  getUnstakeInstructionAsync,
} from "@solans/client";
import {
  fundedSigner,
  initStaking,
  logsOf,
  mintTokens,
  readTokenAmount,
  registerName,
  send,
  sendExpectingFailure,
  setupEnv,
  type StakingCtx,
  type TestEnv,
} from "./harness.ts";

// Each registration routes 25% of the 1_000_000 (5+-char) fee → 250_000 into the
// pool's reward vault.
const SHARE = 250_000n;

type Staker = { signer: KeyPairSigner; solansAta: Address; rewardAta: Address };

async function makeStaker(env: TestEnv, sc: StakingCtx, solans: bigint): Promise<Staker> {
  const signer = await fundedSigner(env.svm);
  const solansAta = await mintTokens(env, sc.solansMint, signer.address, solans);
  const rewardAta = await mintTokens(env, env.mint, signer.address, 0n); // create the reward ATA
  return { signer, solansAta, rewardAta };
}

async function stake(env: TestEnv, sc: StakingCtx, s: Staker, amount: bigint) {
  await send(env.svm, s.signer, [
    await getStakeInstructionAsync({
      staker: s.signer,
      stakerTokenAccount: s.solansAta,
      stakerRewardAccount: s.rewardAta,
      stakeVault: sc.stakeVault,
      rewardVault: sc.rewardVault,
      solansMint: sc.solansMint,
      paymentMint: env.mint,
      amount,
    }),
  ]);
}

async function claim(env: TestEnv, sc: StakingCtx, s: Staker) {
  await send(env.svm, s.signer, [
    await getClaimRewardsInstructionAsync({
      staker: s.signer,
      stakerRewardAccount: s.rewardAta,
      rewardVault: sc.rewardVault,
      paymentMint: env.mint,
    }),
  ]);
}

async function unstakeIx(env: TestEnv, sc: StakingCtx, s: Staker, amount: bigint) {
  return getUnstakeInstructionAsync({
    staker: s.signer,
    stakerTokenAccount: s.solansAta,
    stakerRewardAccount: s.rewardAta,
    stakeVault: sc.stakeVault,
    rewardVault: sc.rewardVault,
    solansMint: sc.solansMint,
    paymentMint: env.mint,
    amount,
  });
}

const reward = (env: TestEnv, s: Staker) => readTokenAmount(env.svm, s.rewardAta)!;

describe("$SOLANS staking", () => {
  it("a single staker earns the entire fee share", async () => {
    const env = await setupEnv();
    const sc = await initStaking(env);
    const a = await makeStaker(env, sc, 1000n);
    await stake(env, sc, a, 1000n);

    await registerName(env, "abcdef"); // +SHARE into the reward vault
    await claim(env, sc, a);
    expect(reward(env, a)).toBe(SHARE);
  });

  it("two stakers split rewards pro-rata by stake weight", async () => {
    const env = await setupEnv();
    const sc = await initStaking(env);
    const a = await makeStaker(env, sc, 100n);
    const b = await makeStaker(env, sc, 300n);
    await stake(env, sc, a, 100n);
    await stake(env, sc, b, 300n); // total 400

    await registerName(env, "abcdef"); // +SHARE
    await claim(env, sc, a);
    await claim(env, sc, b);
    expect(reward(env, a)).toBe((SHARE * 100n) / 400n); // 62_500
    expect(reward(env, b)).toBe((SHARE * 300n) / 400n); // 187_500
  });

  it("staking more settles the pending reward and re-bases (no double claim)", async () => {
    const env = await setupEnv();
    const sc = await initStaking(env);
    const a = await makeStaker(env, sc, 200n);
    await stake(env, sc, a, 100n);

    await registerName(env, "abcdef"); // +SHARE
    await stake(env, sc, a, 100n); // settles the pending SHARE
    expect(reward(env, a)).toBe(SHARE);

    await registerName(env, "ghijkl"); // +SHARE
    await claim(env, sc, a);
    expect(reward(env, a)).toBe(SHARE * 2n); // exactly two deposits, no double
  });

  it("unstake returns the $SOLANS and pays the pending reward", async () => {
    const env = await setupEnv();
    const sc = await initStaking(env);
    const a = await makeStaker(env, sc, 100n);
    await stake(env, sc, a, 100n);
    expect(readTokenAmount(env.svm, a.solansAta)!).toBe(0n);

    await registerName(env, "abcdef"); // +SHARE
    await send(env.svm, a.signer, [await unstakeIx(env, sc, a, 100n)]);
    expect(readTokenAmount(env.svm, a.solansAta)!).toBe(100n); // $SOLANS back
    expect(reward(env, a)).toBe(SHARE); // pending paid
  });

  it("rejects unstaking more than staked (InsufficientStake)", async () => {
    const env = await setupEnv();
    const sc = await initStaking(env);
    const a = await makeStaker(env, sc, 100n);
    await stake(env, sc, a, 50n);
    expect(logsOf(await sendExpectingFailure(env.svm, a.signer, [await unstakeIx(env, sc, a, 100n)]))).toContain(
      "InsufficientStake",
    );
  });

  it("claiming with nothing pending pays zero", async () => {
    const env = await setupEnv();
    const sc = await initStaking(env);
    const a = await makeStaker(env, sc, 100n);
    await stake(env, sc, a, 100n);
    await registerName(env, "abcdef"); // +SHARE
    await claim(env, sc, a); // takes SHARE
    await claim(env, sc, a); // nothing pending
    expect(reward(env, a)).toBe(SHARE);
  });

  it("does not retro-distribute rewards that accrued while nothing was staked", async () => {
    const env = await setupEnv();
    const sc = await initStaking(env);
    await registerName(env, "abcdef"); // +SHARE BEFORE anyone stakes (total_staked == 0)

    const a = await makeStaker(env, sc, 100n);
    await stake(env, sc, a, 100n); // sync skips the pre-stake share; watermark advances past it
    await registerName(env, "ghijkl"); // +SHARE while staked
    await claim(env, sc, a);
    expect(reward(env, a)).toBe(SHARE); // only the post-stake deposit
  });
});
