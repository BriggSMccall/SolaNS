import { beforeAll, describe, expect, it } from "vitest";
import { findReverseRecordPda, getSetReverseInstructionAsync, getTransferNameInstruction } from "@solans/client";
import {
  fundedSigner,
  readName,
  readReverse,
  registerName,
  send,
  setupEnv,
  type TestEnv,
} from "./harness.ts";

describe("set_reverse + reverse lookup", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupEnv();
  });

  it("stores the human name and round-trips back to the owner", async () => {
    const pda = await registerName(env, "primary");
    await send(env.svm, env.payer, [
      await getSetReverseInstructionAsync({ owner: env.payer, nameRecord: pda, name: "primary" }),
    ]);

    const [rpda] = await findReverseRecordPda({ owner: env.payer.address });
    const rev = readReverse(env.svm, rpda)!;
    expect(rev.name).toBe("primary");
    expect(rev.tld).toBe("sol");
    expect(rev.owner).toBe(env.payer.address);
    expect(readName(env.svm, pda)!.reverseSet).toBe(true);
    // round-trip: forward record is still owned by the queried wallet
    expect(readName(env.svm, pda)!.owner).toBe(rev.owner);
  });

  it("reverse goes stale (owner mismatch) once the name is transferred away", async () => {
    const pda = await registerName(env, "wander");
    await send(env.svm, env.payer, [
      await getSetReverseInstructionAsync({ owner: env.payer, nameRecord: pda, name: "wander" }),
    ]);
    const other = await fundedSigner(env.svm);
    await send(env.svm, env.payer, [
      getTransferNameInstruction({ owner: env.payer, nameRecord: pda, newOwner: other.address }),
    ]);

    const [rpda] = await findReverseRecordPda({ owner: env.payer.address });
    const rev = readReverse(env.svm, rpda)!;
    const fwd = readName(env.svm, pda)!;
    // reverse still points at the name, but forward ownership diverged -> resolver must reject it
    expect(rev.owner).toBe(env.payer.address);
    expect(fwd.owner).not.toBe(rev.owner);
    expect(fwd.reverseSet).toBe(false); // transfer cleared the flag
  });
});
