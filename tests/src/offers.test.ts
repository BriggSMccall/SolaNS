import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSigner, unwrapOption, type Address, type KeyPairSigner } from "@solana/kit";
import {
  findConfigPda,
  findNameRecordPda,
  findOffer,
  getAcceptOfferInstruction,
  getCancelOfferInstruction,
  getTokenizeNameInstructionAsync,
  nameInfo,
} from "@solans/client";
import {
  acceptOffer,
  accountExists,
  fundedSigner,
  listName,
  logsOf,
  makeOffer,
  readName,
  registerName,
  send,
  sendExpectingFailure,
  setupEnv,
  solBalance,
  warpToUnixTimestamp,
  wrapSubdomain,
  type TestEnv,
} from "./harness.ts";

const FEE_BPS = 200n;
const OFFER = 4_000_000_000n; // 4 SOL
const feeOf = (amount: bigint) => (amount * FEE_BPS) / 10_000n;
const nrPda = async (name: string) => (await findNameRecordPda({ nameHash: nameInfo(name).hash }))[0];

/** Build an accept_offer ix (for failure paths) with a chosen owner signer. */
async function acceptIx(env: TestEnv, name: string, buyer: Address, owner: KeyPairSigner) {
  const [nameRecord] = await findNameRecordPda({ nameHash: nameInfo(name).hash });
  const [offer] = await findOffer(name, buyer);
  const [config] = await findConfigPda();
  return getAcceptOfferInstruction({ owner, buyer, solTreasury: env.solTreasury, config, nameRecord, offer });
}

/** Build a cancel_offer ix for `buyer`'s offer, signed by `canceller`. */
async function cancelIx(name: string, buyer: Address, canceller: KeyPairSigner) {
  const [nameRecord] = await findNameRecordPda({ nameHash: nameInfo(name).hash });
  const [offer] = await findOffer(name, buyer);
  return getCancelOfferInstruction({ canceller, buyer, nameRecord, offer });
}

describe("marketplace offers (make / accept / cancel)", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupEnv();
  });

  it("make then accept: name → bidder, owner paid, treasury fee exact, bidder refunded rent", async () => {
    const pda = await registerName(env, "off1");
    const bidder = await fundedSigner(env.svm);
    const offerPda = await makeOffer(env, "off1", bidder, OFFER);

    const ownerBefore = solBalance(env.svm, env.payer.address);
    const treasuryBefore = solBalance(env.svm, env.solTreasury);
    const bidderBefore = solBalance(env.svm, bidder.address);

    await acceptOffer(env, "off1", bidder.address); // owner = env.payer

    expect(solBalance(env.svm, env.solTreasury) - treasuryBefore).toBe(feeOf(OFFER)); // exact
    expect(solBalance(env.svm, env.payer.address) - ownerBefore).toBeGreaterThan(0n); // got the proceeds
    expect(solBalance(env.svm, bidder.address) - bidderBefore).toBeGreaterThan(0n); // rent refunded
    expect(readName(env.svm, pda)!.owner).toBe(bidder.address);
    expect(accountExists(env.svm, offerPda)).toBe(false); // offer closed
  });

  it("bidder cancels and is refunded the escrow + rent", async () => {
    await registerName(env, "off2");
    const bidder = await fundedSigner(env.svm);
    const offerPda = await makeOffer(env, "off2", bidder, OFFER);
    const before = solBalance(env.svm, bidder.address);

    await send(env.svm, bidder, [await cancelIx("off2", bidder.address, bidder)]);
    expect(accountExists(env.svm, offerPda)).toBe(false);
    expect(solBalance(env.svm, bidder.address) - before).toBeGreaterThan(OFFER - 100_000_000n); // ~escrow + rent back
  });

  it("the name owner can reject an offer (refunds the bidder)", async () => {
    await registerName(env, "off3");
    const bidder = await fundedSigner(env.svm);
    const offerPda = await makeOffer(env, "off3", bidder, OFFER);
    const before = solBalance(env.svm, bidder.address);

    await send(env.svm, env.payer, [await cancelIx("off3", bidder.address, env.payer)]); // owner rejects
    expect(accountExists(env.svm, offerPda)).toBe(false);
    expect(solBalance(env.svm, bidder.address) - before).toBeGreaterThanOrEqual(OFFER); // full refund, no tx fee
  });

  it("supports concurrent offers: owner accepts one, the other stays cancelable", async () => {
    const pda = await registerName(env, "off5");
    const b1 = await fundedSigner(env.svm);
    const b2 = await fundedSigner(env.svm);
    const o1 = await makeOffer(env, "off5", b1, OFFER);
    await makeOffer(env, "off5", b2, OFFER * 2n);

    await acceptOffer(env, "off5", b2.address); // owner accepts b2's higher bid
    expect(readName(env.svm, pda)!.owner).toBe(b2.address);

    expect(accountExists(env.svm, o1)).toBe(true); // b1's offer survives
    await send(env.svm, b1, [await cancelIx("off5", b1.address, b1)]);
    expect(accountExists(env.svm, o1)).toBe(false);
  });

  it("rejects accept by a non-owner / self-offer / listed / tokenized name", async () => {
    // non-owner
    await registerName(env, "off6");
    const bidder = await fundedSigner(env.svm);
    await makeOffer(env, "off6", bidder, OFFER);
    const stranger = await fundedSigner(env.svm);
    expect(logsOf(await sendExpectingFailure(env.svm, stranger, [await acceptIx(env, "off6", bidder.address, stranger)]))).toContain("NotOwner");

    // self-offer (owner bids on own name, then tries to accept)
    await registerName(env, "off7");
    await makeOffer(env, "off7", env.payer, OFFER);
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [await acceptIx(env, "off7", env.payer.address, env.payer)]))).toContain("SelfPurchase");

    // listed name — must cancel the listing first
    await registerName(env, "off8");
    const b8 = await fundedSigner(env.svm);
    await makeOffer(env, "off8", b8, OFFER);
    await listName(env, "off8", 5_000_000_000n);
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [await acceptIx(env, "off8", b8.address, env.payer)]))).toContain("Listed");

    // tokenized name — trade the NFT instead
    const pda9 = await registerName(env, "off9");
    await send(env.svm, env.payer, [
      await getTokenizeNameInstructionAsync({ owner: env.payer, nameRecord: pda9, mint: await generateKeyPairSigner(), name: "off9" }),
    ]);
    const b9 = await fundedSigner(env.svm);
    await makeOffer(env, "off9", b9, OFFER);
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [await acceptIx(env, "off9", b9.address, env.payer)]))).toContain("Tokenized");
  });

  it("can offer on and accept a subdomain (parent preserved)", async () => {
    await registerName(env, "par2");
    const subPda = await wrapSubdomain(env, "par2", "shop"); // shop.par2.sol
    const par2Pda = await nrPda("par2");
    const bidder = await fundedSigner(env.svm);

    await makeOffer(env, "shop.par2", bidder, OFFER);
    await acceptOffer(env, "shop.par2", bidder.address);

    const sub = readName(env.svm, subPda)!;
    expect(sub.owner).toBe(bidder.address);
    expect(unwrapOption(sub.parent)).toBe(par2Pda);
    expect(sub.depth).toBe(1);
  });
});

describe("offers — expiry", () => {
  it("rejects accepting an expired offer; anyone may clean it up (refund)", async () => {
    const env = await setupEnv();
    await registerName(env, "offx");
    const bidder = await fundedSigner(env.svm);
    const offerPda = await makeOffer(env, "offx", bidder, OFFER, { durationSeconds: 3_600n });

    warpToUnixTimestamp(env.svm, env.svm.getClock().unixTimestamp + 7_200n); // +2h

    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [await acceptIx(env, "offx", bidder.address, env.payer)]))).toContain("OfferExpired");

    const stranger = await fundedSigner(env.svm);
    await send(env.svm, stranger, [await cancelIx("offx", bidder.address, stranger)]); // cleanup
    expect(accountExists(env.svm, offerPda)).toBe(false);
  });
});
