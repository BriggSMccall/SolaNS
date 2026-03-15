import { beforeAll, describe, expect, it } from "vitest";
import { getBurnNameInstruction, getLockTransferInstruction, getTransferNameInstruction } from "@solans/client";
import {
  fundedSigner,
  logsOf,
  readName,
  registerName,
  send,
  sendExpectingFailure,
  setupEnv,
  type TestEnv,
} from "./harness.ts";

describe("transfer / lock / burn", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupEnv();
  });

  it("owner can transfer; a non-owner cannot (NotOwner)", async () => {
    const pda = await registerName(env, "movable");
    const newOwner = await fundedSigner(env.svm);
    const stranger = await fundedSigner(env.svm);

    const res = await sendExpectingFailure(env.svm, stranger, [
      getTransferNameInstruction({ owner: stranger, nameRecord: pda, newOwner: newOwner.address }),
    ]);
    expect(logsOf(res)).toContain("NotOwner");

    await send(env.svm, env.payer, [
      getTransferNameInstruction({ owner: env.payer, nameRecord: pda, newOwner: newOwner.address }),
    ]);
    expect(readName(env.svm, pda)!.owner).toBe(newOwner.address);
  });

  it("a locked name cannot be transferred until unlocked", async () => {
    const pda = await registerName(env, "lockme");
    const newOwner = await fundedSigner(env.svm);

    await send(env.svm, env.payer, [getLockTransferInstruction({ owner: env.payer, nameRecord: pda, lock: true })]);
    const res = await sendExpectingFailure(env.svm, env.payer, [
      getTransferNameInstruction({ owner: env.payer, nameRecord: pda, newOwner: newOwner.address }),
    ]);
    expect(logsOf(res)).toContain("TransferLocked");

    await send(env.svm, env.payer, [getLockTransferInstruction({ owner: env.payer, nameRecord: pda, lock: false })]);
    await send(env.svm, env.payer, [
      getTransferNameInstruction({ owner: env.payer, nameRecord: pda, newOwner: newOwner.address }),
    ]);
    expect(readName(env.svm, pda)!.owner).toBe(newOwner.address);
  });

  it("burn closes the account (rent reclaimed)", async () => {
    const pda = await registerName(env, "burnable");
    expect(readName(env.svm, pda)).not.toBeNull();
    await send(env.svm, env.payer, [getBurnNameInstruction({ owner: env.payer, nameRecord: pda })]);
    expect(readName(env.svm, pda)).toBeNull();
  });
});
