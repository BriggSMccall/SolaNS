import { describe, expect, it } from "vitest";
import { getAddressDecoder } from "@solana/kit";
import {
  findConfigPda,
  getResolveInstruction,
  getTransferAdminInstructionAsync,
  getUpdateRecordInstruction,
  nameInfo,
  nameParts,
} from "@solans/client";
import {
  fundedSigner,
  logsOf,
  readConfig,
  readName,
  registerName,
  returnDataOf,
  send,
  sendExpectingFailure,
  setupEnv,
  warpToUnixTimestamp,
  wrapSubdomain,
} from "./harness.ts";

const decodeAddr = (b: Uint8Array) => getAddressDecoder().decode(b);

describe("resolve (on-chain CPI resolver, §5.2)", () => {
  it("returns the owner pubkey via return_data", async () => {
    const env = await setupEnv();
    const pda = await registerName(env, "alpha");
    const { hash } = nameParts("alpha");
    const meta = await send(env.svm, env.payer, [
      getResolveInstruction({ nameRecord: pda, nameHash: hash, recordKey: null }),
    ]);
    expect(decodeAddr(returnDataOf(meta))).toBe(env.payer.address);
  });

  it("returns a record value when a key is given (empty when unset)", async () => {
    const env = await setupEnv();
    const pda = await registerName(env, "alpha");
    const { hash } = nameParts("alpha");

    // unset -> empty
    const empty = await send(env.svm, env.payer, [
      getResolveInstruction({ nameRecord: pda, nameHash: hash, recordKey: "address.SOL" }),
    ]);
    expect(returnDataOf(empty).length).toBe(0);

    await send(env.svm, env.payer, [
      getUpdateRecordInstruction({ authority: env.payer, nameRecord: pda, key: "address.SOL", value: "So1111", nftTokenAccount: undefined }),
    ]);
    const meta = await send(env.svm, env.payer, [
      getResolveInstruction({ nameRecord: pda, nameHash: hash, recordKey: "address.SOL" }),
    ]);
    expect(new TextDecoder().decode(returnDataOf(meta))).toBe("So1111");
  });

  it("rejects an expired name (NameExpired)", async () => {
    const env = await setupEnv();
    const pda = await registerName(env, "alpha");
    const { hash } = nameParts("alpha");
    warpToUnixTimestamp(env.svm, readName(env.svm, pda)!.expiresAt + 1n);
    const res = await sendExpectingFailure(env.svm, env.payer, [
      getResolveInstruction({ nameRecord: pda, nameHash: hash, recordKey: null }),
    ]);
    expect(logsOf(res)).toContain("NameExpired");
  });

  it("rejects a name_record that does not match the requested hash (NameMismatch)", async () => {
    const env = await setupEnv();
    const alpha = await registerName(env, "alpha");
    await registerName(env, "beta");
    const { hash: betaHash } = nameParts("beta");
    const res = await sendExpectingFailure(env.svm, env.payer, [
      getResolveInstruction({ nameRecord: alpha, nameHash: betaHash, recordKey: null }),
    ]);
    expect(logsOf(res)).toContain("NameMismatch");
  });

  it("resolves a subdomain leaf to its owner", async () => {
    const env = await setupEnv();
    await registerName(env, "parent");
    const child = await wrapSubdomain(env, "parent", "sub");
    const meta = await send(env.svm, env.payer, [
      getResolveInstruction({ nameRecord: child, nameHash: nameInfo("sub.parent").hash, recordKey: null }),
    ]);
    expect(decodeAddr(returnDataOf(meta))).toBe(env.payer.address);
  });
});

describe("transfer_admin (admin rotation)", () => {
  it("rotates the admin; the new admin governs and the old + strangers cannot", async () => {
    const env = await setupEnv();
    const [config] = await findConfigPda();
    const next = await fundedSigner(env.svm);

    // a non-admin cannot rotate
    const bad = await sendExpectingFailure(env.svm, next, [
      await getTransferAdminInstructionAsync({ admin: next, newAdmin: next.address }),
    ]);
    expect(logsOf(bad)).toContain("NotAdmin");

    // the admin rotates to `next`
    await send(env.svm, env.payer, [await getTransferAdminInstructionAsync({ admin: env.payer, newAdmin: next.address })]);
    expect(readConfig(env.svm, config)!.admin).toBe(next.address);

    // the old admin can no longer rotate; the new admin can (rotate back)
    const stale = await sendExpectingFailure(env.svm, env.payer, [
      await getTransferAdminInstructionAsync({ admin: env.payer, newAdmin: env.payer.address }),
    ]);
    expect(logsOf(stale)).toContain("NotAdmin");
    await send(env.svm, next, [await getTransferAdminInstructionAsync({ admin: next, newAdmin: env.payer.address })]);
    expect(readConfig(env.svm, config)!.admin).toBe(env.payer.address);
  });
});
