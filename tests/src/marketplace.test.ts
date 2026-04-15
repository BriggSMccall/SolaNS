import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSigner, unwrapOption } from "@solana/kit";
import {
  findConfigPda,
  findListing,
  findNameRecordPda,
  getBurnNameInstruction,
  getBuyNameInstruction,
  getCancelListingInstruction,
  getListNameInstruction,
  getTokenizeNameInstructionAsync,
  getTransferNameInstruction,
  getUpdateListingInstruction,
  getUpdateRecordInstruction,
  nameInfo,
} from "@solans/client";
import {
  accountExists,
  buyName,
  fundedSigner,
  listName,
  logsOf,
  readName,
  readTokenAmount,
  registerName,
  send,
  sendExpectingFailure,
  setupEnv,
  solBalance,
  warpToUnixTimestamp,
  wrapSubdomain,
  type TestEnv,
} from "./harness.ts";

const FEE_BPS = 200n; // matches setupEnv
const PRICE = 10_000_000_000n; // 10 SOL
const feeOf = (price: bigint) => (price * FEE_BPS) / 10_000n;
const nrPda = async (name: string) => (await findNameRecordPda({ nameHash: nameInfo(name).hash }))[0];

describe("marketplace (list / update / cancel / buy)", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupEnv();
  });

  it("lists then buys: owner flips to buyer, SOL moves (treasury fee exact), listing closed", async () => {
    const pda = await registerName(env, "trade");
    const buyer = await fundedSigner(env.svm);
    const listingPda = await listName(env, "trade", PRICE);
    expect(readName(env.svm, pda)!.listed).toBe(true);

    const treasuryBefore = solBalance(env.svm, env.solTreasury);
    const sellerBefore = solBalance(env.svm, env.payer.address);
    const buyerBefore = solBalance(env.svm, buyer.address);

    await buyName(env, "trade", buyer, PRICE, env.payer.address);

    const fee = feeOf(PRICE);
    expect(solBalance(env.svm, env.solTreasury) - treasuryBefore).toBe(fee); // exact
    expect(solBalance(env.svm, env.payer.address) - sellerBefore).toBeGreaterThanOrEqual(PRICE - fee);
    expect(buyerBefore - solBalance(env.svm, buyer.address)).toBeGreaterThanOrEqual(PRICE);

    const nr = readName(env.svm, pda)!;
    expect(nr.owner).toBe(buyer.address);
    expect(nr.listed).toBe(false);
    expect(unwrapOption(nr.controller)).toBeNull();
    expect(accountExists(env.svm, listingPda)).toBe(false); // listing closed
  });

  it("reprices via update_listing, then buys at the new price", async () => {
    await registerName(env, "repriced");
    const buyer = await fundedSigner(env.svm);
    const [listing] = await findListing("repriced");
    await listName(env, "repriced", PRICE);

    const newPrice = 3_000_000_000n;
    await send(env.svm, env.payer, [
      getUpdateListingInstruction({ seller: env.payer, listing, price: newPrice, durationSeconds: BigInt(86_400) }),
    ]);

    const treasuryBefore = solBalance(env.svm, env.solTreasury);
    await buyName(env, "repriced", buyer, newPrice, env.payer.address);
    expect(solBalance(env.svm, env.solTreasury) - treasuryBefore).toBe(feeOf(newPrice));
  });

  it("rejects a wrong expected price (PriceMismatch) and a self-buy (SelfPurchase)", async () => {
    await registerName(env, "guarded");
    await listName(env, "guarded", PRICE);
    const buyer = await fundedSigner(env.svm);
    const [config] = await findConfigPda();
    const nameRecord = await nrPda("guarded");
    const [listing] = await findListing("guarded");
    const common = { solTreasury: env.solTreasury, config, nameRecord, listing, seller: env.payer.address };

    const wrong = getBuyNameInstruction({ ...common, buyer, expectedPrice: PRICE + 1n });
    expect(logsOf(await sendExpectingFailure(env.svm, buyer, [wrong]))).toContain("PriceMismatch");

    const self = getBuyNameInstruction({ ...common, buyer: env.payer, expectedPrice: PRICE });
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [self]))).toContain("SelfPurchase");
  });

  it("freezes the name while listed (transfer / update_record / burn -> Listed), thaws on cancel", async () => {
    const pda = await registerName(env, "frozen");
    await listName(env, "frozen", PRICE);
    const stranger = await fundedSigner(env.svm);

    const t = await sendExpectingFailure(env.svm, env.payer, [
      getTransferNameInstruction({ owner: env.payer, nameRecord: pda, newOwner: stranger.address }),
    ]);
    expect(logsOf(t)).toContain("Listed");
    const u = await sendExpectingFailure(env.svm, env.payer, [
      getUpdateRecordInstruction({ authority: env.payer, nameRecord: pda, key: "url", value: "x" }),
    ]);
    expect(logsOf(u)).toContain("Listed");
    const b = await sendExpectingFailure(env.svm, env.payer, [
      getBurnNameInstruction({ owner: env.payer, nameRecord: pda }),
    ]);
    expect(logsOf(b)).toContain("Listed");

    // Cancel by the seller, then the (now-thawed) name transfers fine.
    const [listing] = await findListing("frozen");
    await send(env.svm, env.payer, [
      getCancelListingInstruction({ canceller: env.payer, seller: env.payer.address, nameRecord: pda, listing }),
    ]);
    expect(readName(env.svm, pda)!.listed).toBe(false);
    expect(accountExists(env.svm, listing)).toBe(false);
    await send(env.svm, env.payer, [
      getTransferNameInstruction({ owner: env.payer, nameRecord: pda, newOwner: stranger.address }),
    ]);
    expect(readName(env.svm, pda)!.owner).toBe(stranger.address);
  });

  it("cannot list a tokenized name (Tokenized)", async () => {
    const pda = await registerName(env, "tok");
    await send(env.svm, env.payer, [
      await getTokenizeNameInstructionAsync({
        owner: env.payer,
        nameRecord: pda,
        mint: await generateKeyPairSigner(),
        name: "tok",
      }),
    ]);
    const [listing] = await findListing("tok");
    const ix = getListNameInstruction({
      owner: env.payer,
      nameRecord: pda,
      listing,
      price: PRICE,
      durationSeconds: BigInt(86_400),
    });
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [ix]))).toContain("Tokenized");
  });

  it("can list and sell a subdomain (parent link preserved)", async () => {
    await registerName(env, "par");
    const subPda = await wrapSubdomain(env, "par", "shop"); // shop.par.sol
    const parPda = await nrPda("par");
    const buyer = await fundedSigner(env.svm);

    await listName(env, "shop.par", PRICE);
    await buyName(env, "shop.par", buyer, PRICE, env.payer.address);

    const sub = readName(env.svm, subPda)!;
    expect(sub.owner).toBe(buyer.address);
    expect(unwrapOption(sub.parent)).toBe(parPda); // still a subdomain of par
    expect(sub.depth).toBe(1);
  });

  it("charges the numeric premium for a ≤4-digit number, not for 5+ digits", async () => {
    // The fee is split across vaults (§8.2), so total it (no referrer).
    const totalFee = () =>
      readTokenAmount(env.svm, env.treasury)! +
      readTokenAmount(env.svm, env.stakingVault)! +
      readTokenAmount(env.svm, env.burnVault)!;
    const t0 = totalFee();
    await registerName(env, "12"); // numeric, 2 digits -> price_numeric (500M)
    const t1 = totalFee();
    expect(t1 - t0).toBe(500_000_000n);

    await registerName(env, "12345"); // numeric but 5 digits -> price_5plus (1M)
    expect(totalFee() - t1).toBe(1_000_000n);
  });
});

describe("marketplace — listing expiry", () => {
  it("rejects buying an expired listing, and anyone may clean it up", async () => {
    const env = await setupEnv();
    const pda = await registerName(env, "lapse");
    const buyer = await fundedSigner(env.svm);
    const [listing] = await findListing("lapse");
    await listName(env, "lapse", PRICE, { durationSeconds: BigInt(3_600) }); // 1h

    warpToUnixTimestamp(env.svm, solNowPlus(env, 7_200n)); // +2h, past the listing

    const ix = getBuyNameInstruction({
      buyer,
      seller: env.payer.address,
      solTreasury: env.solTreasury,
      config: (await findConfigPda())[0],
      nameRecord: pda,
      listing,
      expectedPrice: PRICE,
    });
    expect(logsOf(await sendExpectingFailure(env.svm, buyer, [ix]))).toContain("ListingExpired");

    // A stranger cleans up the expired listing; the name unfreezes.
    const stranger = await fundedSigner(env.svm);
    await send(env.svm, stranger, [
      getCancelListingInstruction({ canceller: stranger, seller: env.payer.address, nameRecord: pda, listing }),
    ]);
    expect(readName(env.svm, pda)!.listed).toBe(false);
    expect(accountExists(env.svm, listing)).toBe(false);
  });
});

function solNowPlus(env: TestEnv, secs: bigint): bigint {
  return env.svm.getClock().unixTimestamp + secs;
}
