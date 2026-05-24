import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSigner, unwrapOption } from "@solana/kit";
import {
  buildRegisterInstructions,
  buildRenewInstructions,
  buildSetHostingInstructions,
  buildUpdateRecordInstructions,
} from "@solans/sdk";
import { readName, readMintSupply, send, setupEnv, type TestEnv } from "./harness.ts";

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
