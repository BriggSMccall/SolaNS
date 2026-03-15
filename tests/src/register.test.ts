import { beforeAll, describe, expect, it } from "vitest";
import { findNameRecordPda, getRegisterNameInstructionAsync, nameHashFor } from "@solans/client";
import { send, setupEnv, readName, type TestEnv } from "./harness.ts";

describe("register_name", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupEnv();
  });

  it("registers a name at the canonical PDA with correct owner/tld/expiry", async () => {
    const ix = await getRegisterNameInstructionAsync({
      payer: env.payer,
      owner: env.payer.address,
      payerTokenAccount: env.payerAta,
      treasuryTokenAccount: env.treasury,
      paymentMint: env.mint,
      name: "alex",
      tld: "sol",
      nameHash: nameHashFor("alex"),
      years: 1,
    });
    await send(env.svm, env.payer, [ix]);

    const [pda] = await findNameRecordPda({ nameHash: nameHashFor("alex") });
    const rec = readName(env.svm, pda);
    expect(rec).not.toBeNull();
    expect(rec!.owner).toBe(env.payer.address);
    expect(rec!.tld).toBe("sol");
    expect(rec!.records.length).toBe(0);
    expect(rec!.transferLocked).toBe(false);
    // expires roughly 1 year out
    const now = env.svm.getClock().unixTimestamp;
    expect(rec!.expiresAt).toBeGreaterThan(now);
  });

  it("rejects a duplicate registration of a live name", async () => {
    const ix = await getRegisterNameInstructionAsync({
      payer: env.payer,
      owner: env.payer.address,
      payerTokenAccount: env.payerAta,
      treasuryTokenAccount: env.treasury,
      paymentMint: env.mint,
      name: "alex",
      tld: "sol",
      nameHash: nameHashFor("alex"),
      years: 1,
    });
    await expect(send(env.svm, env.payer, [ix])).rejects.toThrow();
  });
});
