import { beforeAll, describe, expect, it } from "vitest";
import {
  computeNameHash,
  getRegisterNameInstructionAsync,
  getUpdateRecordInstruction,
} from "@solans/client";
import {
  logsOf,
  registerName,
  send,
  sendExpectingFailure,
  setupEnv,
  type TestEnv,
} from "./harness.ts";

// These deliberately bypass the client normalizer to prove the program enforces
// its own rules — a malicious client cannot register a non-canonical name.
describe("on-chain validation (defense-in-depth)", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupEnv();
  });

  const rawRegister = (name: string, nameHash: Uint8Array, years = 1) =>
    getRegisterNameInstructionAsync({
      payer: env.payer,
      owner: env.payer.address,
      payerTokenAccount: env.payerAta,
      treasuryTokenAccount: env.treasury,
      paymentMint: env.mint,
      name,
      tld: "sol",
      nameHash,
      years,
    });

  it("rejects an out-of-charset (uppercase) name", async () => {
    const res = await sendExpectingFailure(env.svm, env.payer, [
      await rawRegister("BAD", computeNameHash("BAD", "sol")),
    ]);
    expect(logsOf(res)).toContain("InvalidNameCharacter");
  });

  it("rejects a double-hyphen name", async () => {
    const res = await sendExpectingFailure(env.svm, env.payer, [
      await rawRegister("a--b", computeNameHash("a--b", "sol")),
    ]);
    expect(logsOf(res)).toContain("InvalidNameHyphen");
  });

  it("rejects a name_hash that does not match name+tld (NameMismatch)", async () => {
    const res = await sendExpectingFailure(env.svm, env.payer, [
      await rawRegister("alex", computeNameHash("bob", "sol")),
    ]);
    expect(logsOf(res)).toContain("NameMismatch");
  });

  it("rejects years out of bounds (InvalidYears)", async () => {
    const res = await sendExpectingFailure(env.svm, env.payer, [
      await rawRegister("alex", computeNameHash("alex", "sol"), 0),
    ]);
    expect(logsOf(res)).toContain("InvalidYears");
  });

  it("rejects an over-long record value (RecordTooLong)", async () => {
    const pda = await registerName(env, "rec");
    const res = await sendExpectingFailure(env.svm, env.payer, [
      getUpdateRecordInstruction({ authority: env.payer, nameRecord: pda, key: "k", value: "x".repeat(201) }),
    ]);
    expect(logsOf(res)).toContain("RecordTooLong");
  });

  it("enforces the record cap (TooManyRecords)", async () => {
    const pda = await registerName(env, "full");
    for (let i = 0; i < 16; i++) {
      await send(env.svm, env.payer, [
        getUpdateRecordInstruction({ authority: env.payer, nameRecord: pda, key: `k${i}`, value: "v" }),
      ]);
    }
    const res = await sendExpectingFailure(env.svm, env.payer, [
      getUpdateRecordInstruction({ authority: env.payer, nameRecord: pda, key: "k16", value: "v" }),
    ]);
    expect(logsOf(res)).toContain("TooManyRecords");
  });
});
