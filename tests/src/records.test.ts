import { beforeAll, describe, expect, it } from "vitest";
import type { Address } from "@solana/kit";
import { getSetControllerInstruction, getUpdateRecordInstruction } from "@solans/client";
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

describe("update_record / set_controller authorization", () => {
  let env: TestEnv;
  let pda: Address;
  beforeAll(async () => {
    env = await setupEnv();
    pda = await registerName(env, "records");
  });

  it("owner can set and delete records", async () => {
    await send(env.svm, env.payer, [
      getUpdateRecordInstruction({ authority: env.payer, nameRecord: pda, key: "url", value: "https://x.sol" }),
    ]);
    await send(env.svm, env.payer, [
      getUpdateRecordInstruction({ authority: env.payer, nameRecord: pda, key: "twitter", value: "@x" }),
    ]);
    expect(readName(env.svm, pda)!.records.map((r) => r.key).sort()).toEqual(["twitter", "url"]);

    await send(env.svm, env.payer, [
      getUpdateRecordInstruction({ authority: env.payer, nameRecord: pda, key: "twitter", value: null }),
    ]);
    expect(readName(env.svm, pda)!.records.map((r) => r.key)).toEqual(["url"]);
  });

  it("a stranger cannot update records (NotAuthorized)", async () => {
    const stranger = await fundedSigner(env.svm);
    const res = await sendExpectingFailure(env.svm, stranger, [
      getUpdateRecordInstruction({ authority: stranger, nameRecord: pda, key: "x", value: "y" }),
    ]);
    expect(logsOf(res)).toContain("NotAuthorized");
  });

  it("a controller can update records, and loses access once cleared", async () => {
    const controller = await fundedSigner(env.svm);
    await send(env.svm, env.payer, [
      getSetControllerInstruction({ owner: env.payer, nameRecord: pda, controller: controller.address }),
    ]);
    await send(env.svm, controller, [
      getUpdateRecordInstruction({ authority: controller, nameRecord: pda, key: "bio", value: "hi" }),
    ]);
    expect(readName(env.svm, pda)!.records.some((r) => r.key === "bio")).toBe(true);

    await send(env.svm, env.payer, [
      getSetControllerInstruction({ owner: env.payer, nameRecord: pda, controller: null }),
    ]);
    const res = await sendExpectingFailure(env.svm, controller, [
      getUpdateRecordInstruction({ authority: controller, nameRecord: pda, key: "z", value: "1" }),
    ]);
    expect(logsOf(res)).toContain("NotAuthorized");
  });
});
