import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSigner, unwrapOption } from "@solana/kit";
import {
  buildAcceptOfferInstructions,
  buildBuyInstructions,
  buildCancelListingInstructions,
  buildListInstructions,
  buildMakeOfferInstructions,
  buildRegisterInstructions,
  buildRenewInstructions,
  buildSetHostingInstructions,
  buildUpdateRecordInstructions,
  findListing,
} from "@solans/sdk";
import { accountExists, fundedSigner, readName, readMintSupply, send, setupEnv, type TestEnv } from "./harness.ts";

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
