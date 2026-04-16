import { describe, expect, it } from "vitest";
import {
  getBuybackBurnInstructionAsync,
  getSetSolansParamsInstructionAsync,
} from "@solans/client";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  buyback,
  createMint,
  fundedSigner,
  initBurnPool,
  logsOf,
  mintTokens,
  readMintSupply,
  readName,
  readTokenAmount,
  registerName,
  registerWithSolans,
  renewWithSolans,
  sendExpectingFailure,
  setSolansParams,
  setupEnv,
  type TestEnv,
} from "./harness.ts";

// setupEnv prices a 5+-char name at 1_000_000/yr; §8.2 routes 5% (BURN_FEE_BPS) of
// it into the burn vault. rate 1e6 = a 1:1 $SOLANS:payment exchange.
const RATE = 1_000_000n; // SOLANS_RATE_SCALE — 1:1
const DISCOUNT_BPS = 2500; // 25%
const SECONDS_PER_YEAR = 31_536_000n;
const SOLANS_FEE = 750_000n; // 1_000_000 × 1 × (1 − 0.25)
const BURN_SHARE = 50_000n; // 1_000_000 × 5%

/** Enable §8.1: $SOLANS mint, Config-owned burn vault, rate + discount. */
async function enableSolans(env: TestEnv) {
  const solansMint = await createMint(env, 6);
  await initBurnPool(env, solansMint);
  await setSolansParams(env, RATE, DISCOUNT_BPS);
  return solansMint;
}

describe("§8.1 pay-in-$SOLANS + buyback-burn", () => {
  it("pays a registration fee in $SOLANS, burning the discounted amount", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    const ata = await mintTokens(env, solansMint, env.payer.address, 10_000_000n);
    const supplyBefore = readMintSupply(env.svm, solansMint)!;

    const pda = await registerWithSolans(env, "abcdef", solansMint);

    // exactly the discounted fee was burned (balance + total supply both drop)
    expect(readTokenAmount(env.svm, ata)!).toBe(10_000_000n - SOLANS_FEE);
    expect(supplyBefore - readMintSupply(env.svm, solansMint)!).toBe(SOLANS_FEE);

    // the record is created identically to a USDC register (parity: same rights)
    const rec = readName(env.svm, pda)!;
    expect(rec.owner).toBe(env.payer.address);
    expect(rec.depth).toBe(0);
    expect(rec.expiresAt - rec.registeredAt).toBe(SECONDS_PER_YEAR);
  });

  it("renews in $SOLANS, burning the fee and extending expiry", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await mintTokens(env, solansMint, env.payer.address, 10_000_000n);

    const pda = await registerName(env, "renewme"); // USDC register
    const expiresBefore = readName(env.svm, pda)!.expiresAt;
    const supplyBefore = readMintSupply(env.svm, solansMint)!;

    await renewWithSolans(env, "renewme", solansMint);

    expect(readName(env.svm, pda)!.expiresAt).toBe(expiresBefore + SECONDS_PER_YEAR);
    expect(supplyBefore - readMintSupply(env.svm, solansMint)!).toBe(SOLANS_FEE);
  });

  it("rejects pay-in when $SOLANS is not configured (rate 0)", async () => {
    const env = await setupEnv();
    const solansMint = await createMint(env, 6);
    await initBurnPool(env, solansMint); // sets the mint but leaves rate = 0
    await mintTokens(env, solansMint, env.payer.address, 10_000_000n);

    await expect(registerWithSolans(env, "abcdef", solansMint)).rejects.toThrow(/SolansNotConfigured/);
  });

  it("buyback burns $SOLANS and reimburses from the burn vault at the inverse rate", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await mintTokens(env, solansMint, env.payer.address, 10_000_000n);

    await registerName(env, "seedname"); // USDC register seeds the burn vault with BURN_SHARE
    expect(readTokenAmount(env.svm, env.burnVault)!).toBe(BURN_SHARE);

    const usdcBefore = readTokenAmount(env.svm, env.payerAta)!;
    const supplyBefore = readMintSupply(env.svm, solansMint)!;

    await buyback(env, solansMint, BURN_SHARE); // 1:1 → usdc_out == BURN_SHARE

    expect(readTokenAmount(env.svm, env.burnVault)!).toBe(0n); // vault drained
    expect(readTokenAmount(env.svm, env.payerAta)! - usdcBefore).toBe(BURN_SHARE); // keeper reimbursed
    expect(supplyBefore - readMintSupply(env.svm, solansMint)!).toBe(BURN_SHARE); // supply burned
  });

  it("rejects a buyback exceeding the burn vault balance", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await mintTokens(env, solansMint, env.payer.address, 10_000_000n);
    await registerName(env, "seedname"); // vault holds BURN_SHARE (50_000)

    const ix = await getBuybackBurnInstructionAsync({
      keeper: env.payer,
      burnVault: env.burnVault,
      keeperPaymentAccount: env.payerAta,
      keeperSolansAccount: (await findAssociatedTokenPda({ owner: env.payer.address, mint: solansMint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0],
      solansMint,
      paymentMint: env.mint,
      solansAmount: BURN_SHARE * 2n, // would need 100_000 > 50_000 in the vault
    });
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [ix]))).toContain("InsufficientBurnVault");
  });

  it("buyback is permissionless; set_solans_params is admin-only; discount must be < 100%", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await registerName(env, "seedname"); // vault holds BURN_SHARE

    // permissionless: a non-admin keeper can run the buyback
    const keeper = await fundedSigner(env.svm);
    await mintTokens(env, env.mint, keeper.address, 0n); // keeper USDC ATA
    await mintTokens(env, solansMint, keeper.address, BURN_SHARE); // keeper $SOLANS to burn
    await buyback(env, solansMint, BURN_SHARE, keeper);
    expect(readTokenAmount(env.svm, env.burnVault)!).toBe(0n);

    // set_solans_params is admin-gated
    const notAdmin = await getSetSolansParamsInstructionAsync({
      admin: keeper,
      solansRate: RATE,
      solansDiscountBps: 1000,
    });
    expect(logsOf(await sendExpectingFailure(env.svm, keeper, [notAdmin]))).toContain("NotAdmin");

    // a ≥100% discount is rejected
    const badDiscount = await getSetSolansParamsInstructionAsync({
      admin: env.payer,
      solansRate: RATE,
      solansDiscountBps: 10_000,
    });
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [badDiscount]))).toContain("InvalidDiscount");
  });
});
