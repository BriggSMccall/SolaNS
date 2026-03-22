import { beforeAll, describe, expect, it } from "vitest";
import { unwrapOption, type Address } from "@solana/kit";
import {
  getSetControllerInstruction,
  getSetHostingInstruction,
  getSetResolverInstruction,
} from "@solans/client";
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

describe("set_resolver / set_hosting", () => {
  let env: TestEnv;
  let pda: Address;
  beforeAll(async () => {
    env = await setupEnv();
    pda = await registerName(env, "site");
  });

  it("owner sets and clears the resolver; a stranger cannot (NotOwner)", async () => {
    const resolver = (await fundedSigner(env.svm)).address;
    await send(env.svm, env.payer, [getSetResolverInstruction({ owner: env.payer, nameRecord: pda, resolver })]);
    expect(unwrapOption(readName(env.svm, pda)!.resolver)).toBe(resolver);

    await send(env.svm, env.payer, [getSetResolverInstruction({ owner: env.payer, nameRecord: pda, resolver: null })]);
    expect(unwrapOption(readName(env.svm, pda)!.resolver)).toBeNull();

    const stranger = await fundedSigner(env.svm);
    const res = await sendExpectingFailure(env.svm, stranger, [
      getSetResolverInstruction({ owner: stranger, nameRecord: pda, resolver: stranger.address }),
    ]);
    expect(logsOf(res)).toContain("NotOwner");
  });

  it("owner OR controller can set hosting; a stranger cannot (NotAuthorized)", async () => {
    await send(env.svm, env.payer, [
      getSetHostingInstruction({ authority: env.payer, nameRecord: pda, hostingRef: "ipfs://Qm123" }),
    ]);
    expect(unwrapOption(readName(env.svm, pda)!.hostingRef)).toBe("ipfs://Qm123");

    const controller = await fundedSigner(env.svm);
    await send(env.svm, env.payer, [
      getSetControllerInstruction({ owner: env.payer, nameRecord: pda, controller: controller.address }),
    ]);
    await send(env.svm, controller, [
      getSetHostingInstruction({ authority: controller, nameRecord: pda, hostingRef: "ar://Tx456" }),
    ]);
    expect(unwrapOption(readName(env.svm, pda)!.hostingRef)).toBe("ar://Tx456");

    const stranger = await fundedSigner(env.svm);
    const res = await sendExpectingFailure(env.svm, stranger, [
      getSetHostingInstruction({ authority: stranger, nameRecord: pda, hostingRef: "x" }),
    ]);
    expect(logsOf(res)).toContain("NotAuthorized");
  });
});
