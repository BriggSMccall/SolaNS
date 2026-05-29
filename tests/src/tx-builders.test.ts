import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSigner, unwrapOption } from "@solana/kit";
import {
  buildAcceptOfferInstructions,
  buildBidInstructions,
  buildBurnNameInstructions,
  buildBuyInstructions,
  buildCancelListingInstructions,
  buildClaimRewardsInstructions,
  buildListInstructions,
  buildLockTransferInstructions,
  buildMakeOfferInstructions,
  buildRedeemInstructions,
  buildRegisterInstructions,
  buildRenewInstructions,
  buildRevokeSubdomainInstructions,
  buildSetControllerInstructions,
  buildSetHostingInstructions,
  buildSetReverseInstructions,
  buildStakeInstructions,
  buildStartAuctionInstructions,
  buildTokenizeInstructions,
  buildTransferInstructions,
  buildUpdateRecordInstructions,
  buildWrapSubdomainInstructions,
  findListing,
  findNameRecordPda,
  findReverseRecordPda,
  findAuction,
  nameInfo,
} from "@solans/sdk";
import {
  accountExists,
  createMint,
  fundedSigner,
  initBurnPool,
  initStaking,
  mintTokens,
  readAuction,
  readName,
  readMintSupply,
  readReverse,
  readTokenAmount,
  send,
  setSolansParams,
  setupEnv,
  type TestEnv,
} from "./harness.ts";

const YEAR = 31_536_000n;

/**
 * Proves the web app's shared transaction builders (`@solans/sdk` `tx.ts`) produce
 * transactions that actually execute against the on-chain program — the same functions
 * the browser calls with a wallet signer are run here with a keypair in litesvm.
 */
describe("SDK write-instruction builders (web ⇄ on-chain parity)", () => {
  let env: TestEnv;
  // FeeConfig shape the builders read (mirrors SolansClient.getConfig()).
  let cfg: { paymentMint: typeof env.mint; treasuryTokenAccount: typeof env.treasury; stakingVault: typeof env.stakingVault; burnVault: typeof env.burnVault };

  beforeAll(async () => {
    env = await setupEnv();
    cfg = { paymentMint: env.mint, treasuryTokenAccount: env.treasury, stakingVault: env.stakingVault, burnVault: env.burnVault };
  });

  it("buildRegisterInstructions registers a name AND mints its NFT (§6.1 default)", async () => {
    const { instructions, nameRecord, nftMint } = await buildRegisterInstructions({ payer: env.payer, cfg, name: "alex.sol", years: 1 });
    expect(instructions).toHaveLength(2); // register_name + tokenize_name
    await send(env.svm, env.payer, instructions);

    const rec = readName(env.svm, nameRecord);
    expect(rec?.owner).toBe(env.payer.address);
    expect(nftMint).toBeDefined();
    expect(readMintSupply(env.svm, nftMint!)).toBe(1n);
    expect(unwrapOption(rec!.nftMint)).toBe(nftMint);
  });

  it("buildUpdateRecordInstructions sets a record on the tokenized name (NFT-holder auth)", async () => {
    const { instructions, nameRecord, nftMint } = await buildRegisterInstructions({ payer: env.payer, cfg, name: "recordtest.sol" });
    await send(env.svm, env.payer, instructions);

    const upd = await buildUpdateRecordInstructions({ authority: env.payer, nameRecord, nftMint, key: "url", value: "https://alex.xyz" });
    await send(env.svm, env.payer, upd);
    expect(readName(env.svm, nameRecord)!.records.find((r) => r.key === "url")?.value).toBe("https://alex.xyz");
  });

  it("buildSetHostingInstructions attaches a content ref (NFT-holder auth)", async () => {
    const { instructions, nameRecord, nftMint } = await buildRegisterInstructions({ payer: env.payer, cfg, name: "hosted.sol" });
    await send(env.svm, env.payer, instructions);

    await send(env.svm, env.payer, await buildSetHostingInstructions({ authority: env.payer, nameRecord, nftMint, hostingRef: "ipfs://Qm123" }));
    expect(unwrapOption(readName(env.svm, nameRecord)!.hostingRef)).toBe("ipfs://Qm123");
  });

  it("buildRenewInstructions extends expiry by the term", async () => {
    const { instructions, nameRecord } = await buildRegisterInstructions({ payer: env.payer, cfg, name: "renewme.sol", years: 1 });
    await send(env.svm, env.payer, instructions);
    const before = readName(env.svm, nameRecord)!.expiresAt;

    await send(env.svm, env.payer, await buildRenewInstructions({ payer: env.payer, cfg, name: "renewme.sol", years: 2 }));
    expect(readName(env.svm, nameRecord)!.expiresAt).toBe(before + YEAR * 2n);
  });

  it("registering to a third-party owner skips the NFT (tokenize is owner-gated)", async () => {
    const other = await generateKeyPairSigner();
    const { instructions, nameRecord, nftMint } = await buildRegisterInstructions({ payer: env.payer, cfg, owner: other.address, name: "gift.sol" });
    expect(instructions).toHaveLength(1); // register_name only
    expect(nftMint).toBeUndefined();
    await send(env.svm, env.payer, instructions);
    expect(readName(env.svm, nameRecord)!.owner).toBe(other.address);
  });
});

describe("SDK marketplace builders (§9.1, web ⇄ on-chain parity)", () => {
  let env: TestEnv;
  let cfg: { paymentMint: typeof env.mint; treasuryTokenAccount: typeof env.treasury; stakingVault: typeof env.stakingVault; burnVault: typeof env.burnVault };

  beforeAll(async () => {
    env = await setupEnv();
    cfg = { paymentMint: env.mint, treasuryTokenAccount: env.treasury, stakingVault: env.stakingVault, burnVault: env.burnVault };
  });

  // Names must be PDA-native (not tokenized) to use the SOL marketplace.
  const registerPlain = async (name: string) => {
    const { instructions, nameRecord } = await buildRegisterInstructions({ payer: env.payer, cfg, name, withNft: false });
    await send(env.svm, env.payer, instructions);
    return nameRecord;
  };

  it("list → buy flips ownership and closes the listing", async () => {
    const nameRecord = await registerPlain("forsale.sol");
    const buyer = await fundedSigner(env.svm, 50n);
    const price = 1_000_000_000n; // 1 SOL

    await send(env.svm, env.payer, await buildListInstructions({ owner: env.payer, name: "forsale.sol", priceLamports: price }));
    await send(env.svm, buyer, await buildBuyInstructions({ buyer, name: "forsale.sol", seller: env.payer.address, expectedPrice: price, solTreasury: env.solTreasury }));

    expect(readName(env.svm, nameRecord)!.owner).toBe(buyer.address);
    const [listing] = await findListing("forsale.sol");
    expect(accountExists(env.svm, listing)).toBe(false);
  });

  it("cancel listing leaves the name with the seller", async () => {
    const nameRecord = await registerPlain("unlisted.sol");
    await send(env.svm, env.payer, await buildListInstructions({ owner: env.payer, name: "unlisted.sol", priceLamports: 2_000_000_000n }));
    await send(env.svm, env.payer, await buildCancelListingInstructions({ canceller: env.payer, name: "unlisted.sol", seller: env.payer.address }));

    const [listing] = await findListing("unlisted.sol");
    expect(accountExists(env.svm, listing)).toBe(false);
    expect(readName(env.svm, nameRecord)!.owner).toBe(env.payer.address);
  });

  it("make offer → accept transfers the name to the bidder", async () => {
    const nameRecord = await registerPlain("offered.sol");
    const bidder = await fundedSigner(env.svm, 50n);

    await send(env.svm, bidder, await buildMakeOfferInstructions({ buyer: bidder, name: "offered.sol", amountLamports: 1_500_000_000n }));
    await send(env.svm, env.payer, await buildAcceptOfferInstructions({ owner: env.payer, name: "offered.sol", buyer: bidder.address, solTreasury: env.solTreasury }));

    expect(readName(env.svm, nameRecord)!.owner).toBe(bidder.address);
  });
});

describe("SDK identity / subdomain / NFT / auction / staking builders (web ⇄ on-chain parity)", () => {
  let env: TestEnv;
  let cfg: { paymentMint: typeof env.mint; treasuryTokenAccount: typeof env.treasury; stakingVault: typeof env.stakingVault; burnVault: typeof env.burnVault };

  beforeAll(async () => {
    env = await setupEnv();
    cfg = { paymentMint: env.mint, treasuryTokenAccount: env.treasury, stakingVault: env.stakingVault, burnVault: env.burnVault };
  });

  const registerPlain = async (name: string) => {
    const { instructions, nameRecord } = await buildRegisterInstructions({ payer: env.payer, cfg, name, withNft: false });
    await send(env.svm, env.payer, instructions);
    return nameRecord;
  };

  it("transfer moves ownership", async () => {
    const nr = await registerPlain("xfer.sol");
    const other = await generateKeyPairSigner();
    await send(env.svm, env.payer, await buildTransferInstructions({ owner: env.payer, name: "xfer.sol", newOwner: other.address }));
    expect(readName(env.svm, nr)!.owner).toBe(other.address);
  });

  it("set-controller, lock, and set-reverse", async () => {
    const nr = await registerPlain("ident.sol");
    const ctrl = await generateKeyPairSigner();
    await send(env.svm, env.payer, await buildSetControllerInstructions({ owner: env.payer, name: "ident.sol", controller: ctrl.address }));
    expect(unwrapOption(readName(env.svm, nr)!.controller)).toBe(ctrl.address);

    await send(env.svm, env.payer, await buildLockTransferInstructions({ owner: env.payer, name: "ident.sol", lock: true }));
    expect(readName(env.svm, nr)!.transferLocked).toBe(true);

    await send(env.svm, env.payer, await buildSetReverseInstructions({ owner: env.payer, name: "ident.sol" }));
    const [rev] = await findReverseRecordPda({ owner: env.payer.address });
    expect(readReverse(env.svm, rev)!.nameHash).toEqual(Uint8Array.from(nameInfo("ident.sol").hash));
  });

  it("tokenize then redeem round-trips the NFT", async () => {
    const nr = await registerPlain("nftme.sol");
    const { instructions, nftMint } = await buildTokenizeInstructions({ owner: env.payer, name: "nftme.sol" });
    await send(env.svm, env.payer, instructions);
    expect(unwrapOption(readName(env.svm, nr)!.nftMint)).toBe(nftMint);
    expect(readMintSupply(env.svm, nftMint)).toBe(1n);

    await send(env.svm, env.payer, await buildRedeemInstructions({ redeemer: env.payer, name: "nftme.sol", nftMint }));
    expect(unwrapOption(readName(env.svm, nr)!.nftMint)).toBeNull();
  });

  it("wrap then revoke a subdomain", async () => {
    await registerPlain("parent.sol");
    const { instructions, childName } = await buildWrapSubdomainInstructions({ owner: env.payer, parent: "parent.sol", label: "pay" });
    expect(childName).toBe("pay.parent.sol");
    await send(env.svm, env.payer, instructions);
    const [child] = await findNameRecordPda({ nameHash: nameInfo("pay.parent.sol").hash });
    expect(readName(env.svm, child)!.owner).toBe(env.payer.address);

    await send(env.svm, env.payer, await buildRevokeSubdomainInstructions({ owner: env.payer, parent: "parent.sol", label: "pay" }));
    expect(accountExists(env.svm, child)).toBe(false);
  });

  it("burn releases a name", async () => {
    const nr = await registerPlain("gone.sol");
    await send(env.svm, env.payer, await buildBurnNameInstructions({ owner: env.payer, name: "gone.sol" }));
    expect(accountExists(env.svm, nr)).toBe(false);
  });

  it("start an auction and place a bid", async () => {
    // Register before enabling $SOLANS: initBurnPool repoints Config.burn_vault, which
    // would make registerPlain's captured `cfg` stale.
    await registerPlain("auct.sol");
    const solansMint = await createMint(env, 6);
    await initBurnPool(env, solansMint);
    await setSolansParams(env, 1_000_000n, 0);
    await send(env.svm, env.payer, await buildStartAuctionInstructions({ owner: env.payer, name: "auct.sol", solansMint, reservePrice: 1000n, durationSeconds: 1000n }));
    const [auction] = await findAuction("auct.sol");
    expect(readAuction(env.svm, auction)).not.toBeNull();

    const bidder = await fundedSigner(env.svm);
    await mintTokens(env, solansMint, bidder.address, 5000n);
    await send(env.svm, bidder, await buildBidInstructions({ bidder, name: "auct.sol", solansMint, amount: 2000n }));
    const a = readAuction(env.svm, auction)!;
    expect(a.highestBid).toBe(2000n);
    expect(unwrapOption(a.highestBidder)).toBe(bidder.address);
  });

  it("stake $SOLANS and claim (no reward yet)", async () => {
    const e2 = await setupEnv();
    const pool = await initStaking(e2);
    const staker = await fundedSigner(e2.svm);
    await mintTokens(e2, pool.solansMint, staker.address, 10_000n);
    await mintTokens(e2, e2.mint, staker.address, 0n); // staker reward ATA
    await send(e2.svm, staker, await buildStakeInstructions({ staker, pool, paymentMint: e2.mint, amount: 4000n }));
    expect(readTokenAmount(e2.svm, pool.stakeVault)).toBe(4000n);

    // claim with no accrued reward succeeds (pays 0)
    await send(e2.svm, staker, await buildClaimRewardsInstructions({ staker, pool, paymentMint: e2.mint }));
  });
});
