import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSigner, unwrapOption, type Address, type KeyPairSigner } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  findMasterEditionPda,
  findMetadataPda,
  getBurnNameInstruction,
  getRedeemNameInstructionAsync,
  getSetResolverInstruction,
  getTokenizeNameInstructionAsync,
  getTransferNameInstruction,
  getUpdateRecordInstruction,
} from "@solans/client";
import {
  accountExists,
  fundedSigner,
  logsOf,
  MPL_PROGRAM_ADDRESS,
  readName,
  readTokenAmount,
  registerName,
  send,
  sendExpectingFailure,
  setupEnv,
  type TestEnv,
} from "./harness.ts";

const ataOf = async (owner: Address, mint: Address): Promise<Address> =>
  (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

// A narrative suite (ordered): register -> tokenize -> dynamic-update -> redeem
// -> re-tokenize, asserting the auth model and the Metaplex side effects.
describe("tokenize_name / redeem_name (NFT layer)", () => {
  let env: TestEnv;
  let pda: Address;
  let mint: KeyPairSigner;
  let ownerAta: Address;
  let metadataPda: Address;
  let masterEditionPda: Address;
  let buyer: KeyPairSigner;
  let buyerAta: Address;

  beforeAll(async () => {
    env = await setupEnv();
    pda = await registerName(env, "alpha"); // owner = payer, ".sol"
  });

  it("owner tokenizes: mints a 1-of-1 to the owner's ATA, sets nft_mint, creates metadata + edition", async () => {
    mint = await generateKeyPairSigner();
    const ix = await getTokenizeNameInstructionAsync({ owner: env.payer, nameRecord: pda, mint, name: "alpha" });
    await send(env.svm, env.payer, [ix]);

    ownerAta = await ataOf(env.payer.address, mint.address);
    // These PDAs live under the Metaplex program, so override codama's default
    // (which is the SOLANS program id) with `programAddress: <metaqbxx>`.
    const mplCfg = { programAddress: MPL_PROGRAM_ADDRESS };
    [metadataPda] = await findMetadataPda({ metadataProgram: MPL_PROGRAM_ADDRESS, mint: mint.address }, mplCfg);
    [masterEditionPda] = await findMasterEditionPda({ metadataProgram: MPL_PROGRAM_ADDRESS, mint: mint.address }, mplCfg);

    expect(readTokenAmount(env.svm, ownerAta)).toBe(1n);
    expect(accountExists(env.svm, metadataPda)).toBe(true);
    expect(accountExists(env.svm, masterEditionPda)).toBe(true);

    const rec = readName(env.svm, pda)!;
    expect(unwrapOption(rec.nftMint)).toBe(mint.address);
    expect(rec.owner).toBe(env.payer.address); // PDA stays canonical; owner unchanged
  });

  it("rejects tokenizing again while already tokenized (Tokenized)", async () => {
    const m2 = await generateKeyPairSigner();
    const ix = await getTokenizeNameInstructionAsync({ owner: env.payer, nameRecord: pda, mint: m2, name: "alpha" });
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [ix]))).toContain("Tokenized");
  });

  it("blocks structural ops while tokenized (transfer / set_resolver / burn -> Tokenized)", async () => {
    const stranger = await fundedSigner(env.svm);
    const t = await sendExpectingFailure(env.svm, env.payer, [
      getTransferNameInstruction({ owner: env.payer, nameRecord: pda, newOwner: stranger.address }),
    ]);
    expect(logsOf(t)).toContain("Tokenized");
    const r = await sendExpectingFailure(env.svm, env.payer, [
      getSetResolverInstruction({ owner: env.payer, nameRecord: pda, resolver: stranger.address }),
    ]);
    expect(logsOf(r)).toContain("Tokenized");
    const b = await sendExpectingFailure(env.svm, env.payer, [
      getBurnNameInstruction({ owner: env.payer, nameRecord: pda }),
    ]);
    expect(logsOf(b)).toContain("Tokenized");
  });

  it("transfers the NFT; the new holder manages records (dynamic NFT), the stale owner cannot", async () => {
    buyer = await fundedSigner(env.svm);
    buyerAta = await ataOf(buyer.address, mint.address);
    await send(env.svm, env.payer, [
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: env.payer, owner: buyer.address, mint: mint.address }),
      getTransferInstruction({ source: ownerAta, destination: buyerAta, authority: env.payer, amount: 1n }),
    ]);
    expect(readTokenAmount(env.svm, buyerAta)).toBe(1n);
    expect(readTokenAmount(env.svm, ownerAta)).toBe(0n);

    // The holder proves holdership via their token account and updates a record.
    await send(env.svm, buyer, [
      getUpdateRecordInstruction({ authority: buyer, nameRecord: pda, key: "url", value: "https://held", nftTokenAccount: buyerAta }),
    ]);
    expect(readName(env.svm, pda)!.records.find((r) => r.key === "url")?.value).toBe("https://held");

    // The stale original owner can no longer manage records.
    const res = await sendExpectingFailure(env.svm, env.payer, [
      getUpdateRecordInstruction({ authority: env.payer, nameRecord: pda, key: "url", value: "https://stale" }),
    ]);
    expect(logsOf(res)).toContain("NotAuthorized");
  });

  it("the holder redeems: burns the NFT, becomes owner, clears nft_mint", async () => {
    const ix = await getRedeemNameInstructionAsync({
      redeemer: buyer,
      nameRecord: pda,
      mint: mint.address,
      tokenAccount: buyerAta,
    });
    await send(env.svm, buyer, [ix]);

    // The NFT is burned: the holder's token account is closed (amount gone). The
    // Metaplex metadata/edition close behavior is version-dependent, so we assert
    // the SOLANS-meaningful effects (token gone + record reset), not their rent.
    expect(readTokenAmount(env.svm, buyerAta)).toBeNull();

    const rec = readName(env.svm, pda)!;
    expect(unwrapOption(rec.nftMint)).toBeNull();
    expect(rec.owner).toBe(buyer.address); // ownership followed the NFT
    expect(unwrapOption(rec.controller)).toBeNull();
  });

  it("after redeem, structural ops work again and the name can re-tokenize with a fresh mint", async () => {
    // set_resolver now works (not tokenized), signed by the new owner.
    await send(env.svm, buyer, [getSetResolverInstruction({ owner: buyer, nameRecord: pda, resolver: buyer.address })]);
    expect(unwrapOption(readName(env.svm, pda)!.resolver)).toBe(buyer.address);
    await send(env.svm, buyer, [getSetResolverInstruction({ owner: buyer, nameRecord: pda, resolver: null })]);

    const m2 = await generateKeyPairSigner();
    await send(env.svm, buyer, [
      await getTokenizeNameInstructionAsync({ owner: buyer, nameRecord: pda, mint: m2, name: "alpha" }),
    ]);
    expect(unwrapOption(readName(env.svm, pda)!.nftMint)).toBe(m2.address);
    expect(readTokenAmount(env.svm, await ataOf(buyer.address, m2.address))).toBe(1n);
  });
});
