import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSigner, unwrapOption, type Address, type ReadonlyUint8Array } from "@solana/kit";
import {
  computeSubdomainHash,
  findNameRecordPda,
  getBurnNameInstruction,
  getClaimExpiredInstructionAsync,
  getRenewNameInstructionAsync,
  getRevokeSubdomainInstruction,
  getSetReverseInstructionAsync,
  getTokenizeNameInstructionAsync,
  getTransferNameInstruction,
  getUpdateRecordInstruction,
  getWrapSubdomainInstructionAsync,
  nameInfo,
} from "@solans/client";
import { SolansClient } from "@solans/sdk";
import {
  accountExists,
  fundedSigner,
  logsOf,
  mintTokensTo,
  readName,
  registerName,
  send,
  sendExpectingFailure,
  setupEnv,
  warpToUnixTimestamp,
  wrapSubdomain,
  type TestEnv,
} from "./harness.ts";

const sdkFor = (env: TestEnv) => SolansClient.fromFetcher((a) => Promise.resolve(env.svm.getAccount(a)));
const sameBytes = (a: Uint8Array | ReadonlyUint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

/** Build a wrap instruction without sending (for failure-path tests). */
async function wrapIx(env: TestEnv, parentInput: string, label: string, signer = env.payer) {
  const p = nameInfo(parentInput);
  const [parentName] = await findNameRecordPda({ nameHash: p.hash });
  return getWrapSubdomainInstructionAsync({
    owner: signer,
    subdomainOwner: signer.address,
    parentName,
    label,
    nameHash: computeSubdomainHash(p.hash, label),
  });
}

describe("subdomains (wrap / revoke / resolve)", () => {
  let env: TestEnv;
  let parentPda: Address;
  let payPda: Address;

  beforeAll(async () => {
    env = await setupEnv();
    parentPda = await registerName(env, "alex"); // alex.sol, owner = payer
  });

  it("creates a subdomain, links it to the parent, and matches the program hash", async () => {
    payPda = await wrapSubdomain(env, "alex", "pay"); // pay.alex.sol
    const child = readName(env.svm, payPda)!;
    const parent = readName(env.svm, parentPda)!;

    expect(child.owner).toBe(env.payer.address);
    expect(unwrapOption(child.parent)).toBe(parentPda);
    expect(child.depth).toBe(1);
    expect(child.tld).toBe("sol");
    expect(child.parentRegisteredAt).toBe(parent.registeredAt);
    // TS ↔ Rust hash parity: the stored hash equals the client's recursive hash.
    expect(sameBytes(child.nameHash, computeSubdomainHash(nameInfo("alex").hash, "pay"))).toBe(true);

    const r = await sdkFor(env).resolve("pay.alex.sol");
    expect(r?.owner).toBe(env.payer.address);
    expect(unwrapOption(r!.parent)).toBe(parentPda);
  });

  it("nests to depth 2 and resolves the full path", async () => {
    const blogPda = await wrapSubdomain(env, "pay.alex", "blog"); // blog.pay.alex.sol
    const child = readName(env.svm, blogPda)!;
    expect(child.depth).toBe(2);
    expect(unwrapOption(child.parent)).toBe(payPda);
    expect((await sdkFor(env).resolve("blog.pay.alex.sol"))?.owner).toBe(env.payer.address);
  });

  it("rejects re-wrapping the same (parent, label)", async () => {
    const res = await sendExpectingFailure(env.svm, env.payer, [await wrapIx(env, "alex", "pay")]);
    expect(logsOf(res)).toContain("already in use");
  });

  it("is parent-owner-only: a stranger cannot wrap (NotOwner)", async () => {
    const stranger = await fundedSigner(env.svm);
    const res = await sendExpectingFailure(env.svm, stranger, [await wrapIx(env, "alex", "shop", stranger)]);
    expect(logsOf(res)).toContain("NotOwner");
  });

  it("enforces the depth cap (TooDeep beyond MAX_SUBDOMAIN_DEPTH = 4)", async () => {
    await registerName(env, "deep");
    await wrapSubdomain(env, "deep", "a"); // depth 1
    await wrapSubdomain(env, "a.deep", "b"); // depth 2
    await wrapSubdomain(env, "b.a.deep", "c"); // depth 3
    await wrapSubdomain(env, "c.b.a.deep", "d"); // depth 4 (== cap)
    const res = await sendExpectingFailure(env.svm, env.payer, [await wrapIx(env, "d.c.b.a.deep", "e")]);
    expect(logsOf(res)).toContain("TooDeep");
  });

  it("lets the subdomain's own owner manage its records and transfer it", async () => {
    const buyer = await fundedSigner(env.svm);
    const mailPda = await wrapSubdomain(env, "alex", "mail", { owner: buyer.address });
    expect(readName(env.svm, mailPda)!.owner).toBe(buyer.address);

    await send(env.svm, buyer, [
      getUpdateRecordInstruction({ authority: buyer, nameRecord: mailPda, key: "url", value: "https://mail" }),
    ]);
    expect(readName(env.svm, mailPda)!.records.find((r) => r.key === "url")?.value).toBe("https://mail");

    await send(env.svm, buyer, [
      getTransferNameInstruction({ owner: buyer, nameRecord: mailPda, newOwner: env.payer.address }),
    ]);
    expect(readName(env.svm, mailPda)!.owner).toBe(env.payer.address);
  });

  it("rejects tokenize / set_reverse / claim on a subdomain (Subdomain)", async () => {
    const tok = await getTokenizeNameInstructionAsync({
      owner: env.payer,
      nameRecord: payPda,
      mint: await generateKeyPairSigner(),
      name: "pay",
    });
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [tok]))).toContain("Subdomain");

    const rev = await getSetReverseInstructionAsync({ owner: env.payer, nameRecord: payPda, name: "pay" });
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [rev]))).toContain("Subdomain");

    const claim = await getClaimExpiredInstructionAsync({
      claimer: env.payer,
      nameRecord: payPda,
      payerTokenAccount: env.payerAta,
      treasuryTokenAccount: env.treasury,
      stakingVault: env.stakingVault,
      burnVault: env.burnVault,
      paymentMint: env.mint,
      name: "pay",
      tld: "sol",
      years: 1,
    });
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [claim]))).toContain("Subdomain");
  });

  it("revokes a subdomain (parent owner reclaims), but not one belonging to a different parent", async () => {
    const tmpPda = await wrapSubdomain(env, "alex", "temp");
    expect(accountExists(env.svm, tmpPda)).toBe(true);

    // A different parent cannot revoke it (NotParent).
    const [otherParent] = await findNameRecordPda({ nameHash: nameInfo("deep").hash });
    const bad = getRevokeSubdomainInstruction({ owner: env.payer, parentName: otherParent, nameRecord: tmpPda });
    expect(logsOf(await sendExpectingFailure(env.svm, env.payer, [bad]))).toContain("NotParent");

    // The real parent revokes it.
    await send(env.svm, env.payer, [
      getRevokeSubdomainInstruction({ owner: env.payer, parentName: parentPda, nameRecord: tmpPda }),
    ]);
    expect(accountExists(env.svm, tmpPda)).toBe(false);
  });
});

// Chain-integrity tests use fresh envs because they warp / mutate the parent.
describe("subdomain chain integrity", () => {
  it("claiming the parent invalidates the whole subtree (resolves null)", async () => {
    const env = await setupEnv({ gracePeriodSeconds: 0n });
    const treePda = await registerName(env, "tree", { years: 1 });
    await wrapSubdomain(env, "tree", "leaf");
    expect((await sdkFor(env).resolve("leaf.tree.sol"))).not.toBeNull();

    // Warp past expiry, then a stranger claims the parent (rewrites registered_at).
    const expiry = readName(env.svm, treePda)!.expiresAt;
    warpToUnixTimestamp(env.svm, expiry + 10n);
    const claimer = await fundedSigner(env.svm);
    const claimerAta = await mintTokensTo(env, claimer.address, 1_000_000_000_000n);
    await send(env.svm, claimer, [
      await getClaimExpiredInstructionAsync({
        claimer,
        nameRecord: treePda,
        payerTokenAccount: claimerAta,
        treasuryTokenAccount: env.treasury,
        stakingVault: env.stakingVault,
        burnVault: env.burnVault,
        paymentMint: env.mint,
        name: "tree",
        tld: "sol",
        years: 1,
      }),
    ]);

    expect(readName(env.svm, treePda)!.owner).toBe(claimer.address); // parent re-registered
    expect(await sdkFor(env).resolve("leaf.tree.sol")).toBeNull(); // subtree dead
  });

  it("burning the parent makes the subtree unresolvable", async () => {
    const env = await setupEnv();
    const rootPda = await registerName(env, "root2");
    await wrapSubdomain(env, "root2", "sub");
    expect(await sdkFor(env).resolve("sub.root2.sol")).not.toBeNull();

    await send(env.svm, env.payer, [getBurnNameInstruction({ owner: env.payer, nameRecord: rootPda })]);
    expect(await sdkFor(env).resolve("sub.root2.sol")).toBeNull();
  });

  it("renewing the parent keeps the subtree resolvable (registered_at unchanged)", async () => {
    const env = await setupEnv();
    await registerName(env, "keep");
    await wrapSubdomain(env, "keep", "node");
    await send(env.svm, env.payer, [
      await getRenewNameInstructionAsync({
        payer: env.payer,
        nameRecord: (await findNameRecordPda({ nameHash: nameInfo("keep").hash }))[0],
        payerTokenAccount: env.payerAta,
        treasuryTokenAccount: env.treasury,
        stakingVault: env.stakingVault,
        burnVault: env.burnVault,
        paymentMint: env.mint,
        name: "keep",
        tld: "sol",
        years: 1,
      }),
    ]);
    expect(await sdkFor(env).resolve("node.keep.sol")).not.toBeNull();
  });
});
