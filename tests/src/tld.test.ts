import { describe, expect, it } from "vitest";
import { computeNameHash, getRegisterNameInstructionAsync, nameParts } from "@solans/client";
import { logsOf, readName, registerName, sendExpectingFailure, setupEnv } from "./harness.ts";

describe("multi-TLD", () => {
  it("registers the same label under different TLDs as distinct names", async () => {
    const env = await setupEnv();
    const solPda = await registerName(env, "alex.sol");
    const chainPda = await registerName(env, "alex.chain");
    const web3Pda = await registerName(env, "alex.web3");

    expect(new Set([solPda, chainPda, web3Pda]).size).toBe(3); // distinct PDAs
    expect(readName(env.svm, solPda)!.tld).toBe("sol");
    expect(readName(env.svm, chainPda)!.tld).toBe("chain");
    expect(readName(env.svm, web3Pda)!.tld).toBe("web3");
  });

  it("defaults a TLD-less name to .sol", async () => {
    const env = await setupEnv();
    const pda = await registerName(env, "bob");
    expect(readName(env.svm, pda)!.tld).toBe("sol");
  });

  it("rejects an unsupported TLD — on-chain and in the client", async () => {
    const env = await setupEnv();
    // On-chain: bypass the client and send a raw register with tld "xyz".
    const ix = await getRegisterNameInstructionAsync({
      payer: env.payer,
      owner: env.payer.address,
      payerTokenAccount: env.payerAta,
      treasuryTokenAccount: env.treasury,
      paymentMint: env.mint,
      name: "alex",
      tld: "xyz",
      nameHash: computeNameHash("alex", "xyz"),
      years: 1,
    });
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [ix]))).toContain("InvalidTld");

    // Client-side: rejected before building.
    expect(() => nameParts("alex.xyz")).toThrow();
    expect(() => nameParts("alex", "xyz")).toThrow();
  });
});
