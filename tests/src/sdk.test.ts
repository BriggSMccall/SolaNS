import { beforeAll, describe, expect, it } from "vitest";
import { SolansClient } from "@solans/sdk";
import { getSetReverseInstructionAsync, getUpdateRecordInstruction } from "@solans/client";
import { registerName, send, setupEnv, type TestEnv } from "./harness.ts";

describe("@solans/sdk SolansClient", () => {
  let env: TestEnv;
  let sdk: SolansClient;
  beforeAll(async () => {
    env = await setupEnv();
    // Back the SDK with the in-process litesvm account store.
    sdk = SolansClient.fromFetcher((address) => Promise.resolve(env.svm.getAccount(address)));
  });

  it("resolve: null when unregistered, the record once registered", async () => {
    expect(await sdk.resolve("ghost.sol")).toBeNull();
    await registerName(env, "alex.sol");
    const rec = await sdk.resolve("alex.sol");
    expect(rec?.owner).toBe(env.payer.address);
    expect(rec?.tld).toBe("sol");
  });

  it("getRecords / getAddress / getRecord read the key→value store", async () => {
    const pda = await registerName(env, "carol.sol");
    await send(env.svm, env.payer, [
      getUpdateRecordInstruction({ authority: env.payer, nameRecord: pda, key: "address.SOL", value: "So1111" }),
    ]);
    await send(env.svm, env.payer, [
      getUpdateRecordInstruction({ authority: env.payer, nameRecord: pda, key: "url", value: "https://carol.sol" }),
    ]);
    expect((await sdk.getRecords("carol.sol")).map((r) => r.key).sort()).toEqual(["address.SOL", "url"]);
    expect(await sdk.getAddress("carol.sol", "SOL")).toBe("So1111");
    expect(await sdk.getRecord("carol.sol", "url")).toBe("https://carol.sol");
    expect(await sdk.getRecord("carol.sol", "missing")).toBeNull();
  });

  it("reverseLookup: round-trip-validated name across a non-.sol TLD", async () => {
    const pda = await registerName(env, "dave.chain");
    await send(env.svm, env.payer, [
      await getSetReverseInstructionAsync({ owner: env.payer, nameRecord: pda, name: "dave" }),
    ]);
    expect(await sdk.reverseLookup(env.payer.address)).toBe("dave.chain");
  });
});
