import { describe, expect, it } from "vitest";
import { unwrapOption } from "@solana/kit";
import { computeNameHash, getRegisterNameInstructionAsync, isValidName, normalizeName } from "@solans/client";
import {
  logsOf,
  readName,
  readTokenAmount,
  registerAsNft,
  registerName,
  sendExpectingFailure,
  setupEnv,
} from "./harness.ts";

describe("emoji names (§9.2)", () => {
  it("registers an emoji name at 2× the length-tier price", async () => {
    const env = await setupEnv();

    const before1 = readTokenAmount(env.svm, env.payerAta)!;
    await registerName(env, "abcde"); // 5-char ASCII
    const asciiFee = before1 - readTokenAmount(env.svm, env.payerAta)!;

    const before2 = readTokenAmount(env.svm, env.payerAta)!;
    const pda = await registerName(env, "🔥🔥🔥🔥🔥"); // 5 emoji code points
    const emojiFee = before2 - readTokenAmount(env.svm, env.payerAta)!;

    expect(asciiFee).toBe(1_000_000n); // price_5plus
    expect(emojiFee).toBe(2_000_000n); // §9.2 emoji = 2× the length tier
    expect(readName(env.svm, pda)!.owner).toBe(env.payer.address); // it really registered
  });

  it("rejects a Unicode-letter (homograph) name on-chain (InvalidNameCharacter)", async () => {
    const env = await setupEnv();
    // "аbc" — the first char is Cyrillic а (U+0430), a confusable for Latin a.
    // Build the register ix directly (the client's normalizer would reject it first).
    const name = "аbc";
    const hash = computeNameHash(name, "sol");
    const ix = await getRegisterNameInstructionAsync({
      payer: env.payer,
      owner: env.payer.address,
      payerTokenAccount: env.payerAta,
      treasuryTokenAccount: env.treasury,
      stakingVault: env.stakingVault,
      burnVault: env.burnVault,
      paymentMint: env.mint,
      name,
      tld: "sol",
      nameHash: hash,
      years: 1,
    });
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [ix]))).toContain("InvalidNameCharacter");
  });

  it("normalizes/validates client-side: emoji + NFKC ok, Unicode letters rejected", () => {
    expect(isValidName("🔥🔥")).toBe(true);
    expect(isValidName("cool-🚀")).toBe(true);
    expect(isValidName("ＡＢＣ")).toBe(true); // fullwidth → NFKC → "abc"
    expect(normalizeName("FIRE🔥")).toBe("fire🔥"); // lowercased, emoji kept
    expect(isValidName("аbc")).toBe(false); // Cyrillic а
    expect(isValidName("café")).toBe(false); // é is a letter
    expect(isValidName("-🔥")).toBe(false); // leading hyphen
  });

  it("tokenizes a long emoji name without panicking on the 32-byte NFT-name truncation", async () => {
    const env = await setupEnv();
    // 8 emoji (32 bytes) + ".sol" overflows the 32-byte Metaplex name → char-safe pop.
    const [pda, mint] = await registerAsNft(env, "🔥🔥🔥🔥🔥🔥🔥🔥");
    expect(unwrapOption(readName(env.svm, pda)!.nftMint)).toBe(mint.address);
  });
});
