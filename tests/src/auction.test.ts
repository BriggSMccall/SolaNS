import { describe, expect, it } from "vitest";
import { unwrapOption, type Address } from "@solana/kit";
import {
  accountExists,
  bid,
  cancelAuction,
  createMint,
  fundedSigner,
  initBurnPool,
  listName,
  mintTokens,
  readAuction,
  readMintSupply,
  readName,
  readTokenAmount,
  registerName,
  setSolansParams,
  settleAuction,
  setupEnv,
  startAuction,
  unixNow,
  warpToUnixTimestamp,
  type TestEnv,
} from "./harness.ts";

// setupEnv configures a 2% marketplace fee.
const FEE_BPS = 200n;

/** Enable `$SOLANS` (mint + non-zero rate) so auctions can open. */
async function enableSolans(env: TestEnv): Promise<Address> {
  const solansMint = await createMint(env, 6);
  await initBurnPool(env, solansMint);
  await setSolansParams(env, 1_000_000n, 0);
  return solansMint;
}

/** A funded bidder with `amount` `$SOLANS`; returns the signer + its `$SOLANS` ATA. */
async function makeBidder(env: TestEnv, solansMint: Address, amount: bigint) {
  const signer = await fundedSigner(env.svm);
  const ata = await mintTokens(env, solansMint, signer.address, amount);
  return { signer, ata };
}

describe("§9.1 English auctions ($SOLANS)", () => {
  it("opening an auction freezes the name", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    const pda = await registerName(env, "foo");
    const [auction] = await startAuction(env, "foo", solansMint, { reserve: 1000n });

    expect(readName(env.svm, pda)!.listed).toBe(true);
    const a = readAuction(env.svm, auction)!;
    expect(a.seller).toBe(env.payer.address);
    expect(a.reservePrice).toBe(1000n);
  });

  it("a valid bid escrows the $SOLANS into the vault", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await registerName(env, "foo");
    const [auction, bidVault] = await startAuction(env, "foo", solansMint, { reserve: 1000n });
    const a = await makeBidder(env, solansMint, 5000n);

    await bid(env, "foo", solansMint, a.signer, 1000n);
    expect(readTokenAmount(env.svm, bidVault)!).toBe(1000n);
    expect(readTokenAmount(env.svm, a.ata)!).toBe(4000n);
    expect(unwrapOption(readAuction(env.svm, auction)!.highestBidder)).toBe(a.signer.address);
  });

  it("outbidding refunds the previous bidder and re-escrows", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await registerName(env, "foo");
    const [auction, bidVault] = await startAuction(env, "foo", solansMint, { reserve: 1000n });
    const a = await makeBidder(env, solansMint, 5000n);
    const b = await makeBidder(env, solansMint, 5000n);

    await bid(env, "foo", solansMint, a.signer, 1000n);
    await bid(env, "foo", solansMint, b.signer, 1500n);

    expect(readTokenAmount(env.svm, a.ata)!).toBe(5000n); // fully refunded
    expect(readTokenAmount(env.svm, b.ata)!).toBe(3500n); // escrowed 1500
    expect(readTokenAmount(env.svm, bidVault)!).toBe(1500n);
    expect(unwrapOption(readAuction(env.svm, auction)!.highestBidder)).toBe(b.signer.address);
  });

  it("rejects a bid below the reserve or the minimum increment", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await registerName(env, "foo");
    await startAuction(env, "foo", solansMint, { reserve: 1000n, increment: 100n });
    const a = await makeBidder(env, solansMint, 5000n);
    const b = await makeBidder(env, solansMint, 5000n);

    await expect(bid(env, "foo", solansMint, a.signer, 500n)).rejects.toThrow(/BidTooLow/);
    await bid(env, "foo", solansMint, a.signer, 1000n);
    await expect(bid(env, "foo", solansMint, b.signer, 1050n)).rejects.toThrow(/BidTooLow/);
  });

  it("a bid in the final window auto-extends the close time", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await registerName(env, "foo");
    const t0 = unixNow(env.svm);
    const [auction] = await startAuction(env, "foo", solansMint, { reserve: 1000n, durationSeconds: 100n });
    const a = await makeBidder(env, solansMint, 5000n);

    await bid(env, "foo", solansMint, a.signer, 1000n);
    // end was t0+100, inside the 300s window → pushed to t0+300.
    expect(readAuction(env.svm, auction)!.endTime).toBe(t0 + 300n);
  });

  it("rejects a bid after the auction has ended", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await registerName(env, "foo");
    const t0 = unixNow(env.svm);
    await startAuction(env, "foo", solansMint, { reserve: 1000n, durationSeconds: 1000n });
    const a = await makeBidder(env, solansMint, 5000n);

    warpToUnixTimestamp(env.svm, t0 + 2000n);
    await expect(bid(env, "foo", solansMint, a.signer, 1000n)).rejects.toThrow(/AuctionEnded/);
  });

  it("settles to the winner, pays the seller bid−fee, and burns the fee", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    const pda = await registerName(env, "foo");
    const sellerAta = await mintTokens(env, solansMint, env.payer.address, 0n); // seller $SOLANS ATA
    const t0 = unixNow(env.svm);
    const [, bidVault] = await startAuction(env, "foo", solansMint, { reserve: 1000n, durationSeconds: 1000n });
    const a = await makeBidder(env, solansMint, 5000n);
    await bid(env, "foo", solansMint, a.signer, 2000n);

    const supplyBefore = readMintSupply(env.svm, solansMint)!;
    warpToUnixTimestamp(env.svm, t0 + 2000n);
    await settleAuction(env, "foo", solansMint);

    const fee = (2000n * FEE_BPS) / 10_000n; // 40
    expect(readName(env.svm, pda)!.owner).toBe(a.signer.address); // name moved
    expect(readName(env.svm, pda)!.listed).toBe(false); // unfrozen
    expect(readTokenAmount(env.svm, sellerAta)!).toBe(2000n - fee); // 1960
    expect(supplyBefore - readMintSupply(env.svm, solansMint)!).toBe(fee); // burned
    expect(accountExists(env.svm, bidVault)).toBe(false); // vault closed
  });

  it("settles a no-bid auction by just unfreezing the name", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    const pda = await registerName(env, "foo");
    const t0 = unixNow(env.svm);
    const [auction] = await startAuction(env, "foo", solansMint, { reserve: 1000n, durationSeconds: 1000n });

    warpToUnixTimestamp(env.svm, t0 + 2000n);
    await settleAuction(env, "foo", solansMint);

    expect(readName(env.svm, pda)!.owner).toBe(env.payer.address); // unchanged
    expect(readName(env.svm, pda)!.listed).toBe(false);
    expect(accountExists(env.svm, auction)).toBe(false); // auction closed
  });

  it("cancels an auction with no bids (seller)", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    const pda = await registerName(env, "foo");
    const [auction] = await startAuction(env, "foo", solansMint, { reserve: 1000n });

    await cancelAuction(env, "foo", solansMint);
    expect(readName(env.svm, pda)!.listed).toBe(false);
    expect(accountExists(env.svm, auction)).toBe(false);
  });

  it("rejects cancelling once there is a bid", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await registerName(env, "foo");
    await startAuction(env, "foo", solansMint, { reserve: 1000n });
    const a = await makeBidder(env, solansMint, 5000n);
    await bid(env, "foo", solansMint, a.signer, 1000n);

    await expect(cancelAuction(env, "foo", solansMint)).rejects.toThrow(/AuctionHasBids/);
  });

  it("rejects the seller bidding on their own auction", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await registerName(env, "foo");
    await startAuction(env, "foo", solansMint, { reserve: 1000n });
    await mintTokens(env, solansMint, env.payer.address, 5000n);

    await expect(bid(env, "foo", solansMint, env.payer, 1000n)).rejects.toThrow(/SelfBid/);
  });

  it("freezes the name against other market actions while auctioned", async () => {
    const env = await setupEnv();
    const solansMint = await enableSolans(env);
    await registerName(env, "foo");
    await startAuction(env, "foo", solansMint, { reserve: 1000n });

    await expect(listName(env, "foo", 1_000_000n)).rejects.toThrow(/Listed/);
  });
});
