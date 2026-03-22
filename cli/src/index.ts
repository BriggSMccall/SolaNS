import { Command } from "commander";
import { address, unwrapOption } from "@solana/kit";
import {
  findNameRecordPda,
  getBurnNameInstruction,
  getClaimExpiredInstructionAsync,
  getInitConfigInstructionAsync,
  getLockTransferInstruction,
  getRegisterNameInstructionAsync,
  getRenewNameInstructionAsync,
  getSetControllerInstruction,
  getSetHostingInstruction,
  getSetResolverInstruction,
  getSetReverseInstructionAsync,
  getTransferNameInstruction,
  getUpdateConfigInstructionAsync,
  getUpdateRecordInstruction,
  nameHashFor,
  nameParts,
  normalizeName,
} from "@solans/client";
import { SolansClient } from "@solans/sdk";
import {
  ataFor,
  getConfig,
  makeContext,
  reportSig,
  sendInstructions,
  type Ctx,
  type GlobalOpts,
} from "./context.ts";

const program = new Command();
program
  .name("solans")
  .description("SOLANS — decentralized name service CLI")
  .version("0.1.0")
  .option("--cluster <cluster>", "localnet | devnet | mainnet")
  .option("--url <rpcUrl>", "custom RPC URL (overrides --cluster)")
  .option("--ws <wsUrl>", "custom WebSocket URL")
  .option("--keypair <path>", "fee-payer / authority keypair (Solana CLI JSON)")
  .option("--simulate", "simulate only, do not send")
  .option("--json", "machine-readable JSON output");

const g = (cmd: Command): GlobalOpts => cmd.optsWithGlobals();
const nameRecordPda = (name: string) => findNameRecordPda({ nameHash: nameHashFor(name) });

// --- admin -----------------------------------------------------------------
program
  .command("init-config")
  .description("Initialize the registry config (admin, one-time)")
  .requiredOption("--mint <address>", "payment SPL mint")
  .requiredOption("--treasury <address>", "treasury token account (for the mint)")
  .option("--price1 <baseUnits>", "1-char price / year", "1000000000")
  .option("--price2 <baseUnits>", "2-char price / year", "200000000")
  .option("--price3 <baseUnits>", "3-char price / year", "50000000")
  .option("--price4 <baseUnits>", "4-char price / year", "10000000")
  .option("--price5 <baseUnits>", "5+-char price / year", "1000000")
  .option("--grace <seconds>", "grace period before claim", "7776000")
  .option("--min-years <n>", "minimum term", "1")
  .option("--max-years <n>", "maximum term", "10")
  .action(async (o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const ix = await getInitConfigInstructionAsync({
      admin: ctx.signer,
      paymentMint: address(o.mint),
      treasuryTokenAccount: address(o.treasury),
      price1: BigInt(o.price1),
      price2: BigInt(o.price2),
      price3: BigInt(o.price3),
      price4: BigInt(o.price4),
      price5plus: BigInt(o.price5),
      gracePeriodSeconds: BigInt(o.grace),
      minYears: Number(o.minYears),
      maxYears: Number(o.maxYears),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("update-config")
  .description("Update registry economic params, admin only (only provided flags change)")
  .option("--price1 <baseUnits>", "1-char price / year")
  .option("--price2 <baseUnits>", "2-char price / year")
  .option("--price3 <baseUnits>", "3-char price / year")
  .option("--price4 <baseUnits>", "4-char price / year")
  .option("--price5 <baseUnits>", "5+-char price / year")
  .option("--grace <seconds>", "grace period before claim")
  .option("--min-years <n>", "minimum term")
  .option("--max-years <n>", "maximum term")
  .action(async (o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const d = (await getConfig(ctx)).data;
    const ix = await getUpdateConfigInstructionAsync({
      admin: ctx.signer,
      price1: o.price1 ? BigInt(o.price1) : d.price1,
      price2: o.price2 ? BigInt(o.price2) : d.price2,
      price3: o.price3 ? BigInt(o.price3) : d.price3,
      price4: o.price4 ? BigInt(o.price4) : d.price4,
      price5plus: o.price5 ? BigInt(o.price5) : d.price5plus,
      gracePeriodSeconds: o.grace ? BigInt(o.grace) : d.gracePeriodSeconds,
      minYears: o.minYears ? Number(o.minYears) : d.minYears,
      maxYears: o.maxYears ? Number(o.maxYears) : d.maxYears,
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

// --- register / renew / claim ----------------------------------------------
program
  .command("register <name>")
  .description("Register a name (pays the tiered fee in the configured mint)")
  .option("--owner <address>", "owner of the name (default: signer)")
  .option("--years <n>", "term in years", "1")
  .action(async (name, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const { name: label, tld, hash } = nameParts(name);
    const ix = await getRegisterNameInstructionAsync({
      payer: ctx.signer,
      owner: o.owner ? address(o.owner) : ctx.signer.address,
      payerTokenAccount: await ataFor(ctx.signer.address, cfg.data.paymentMint),
      treasuryTokenAccount: cfg.data.treasuryTokenAccount,
      paymentMint: cfg.data.paymentMint,
      name: label,
      tld,
      nameHash: hash,
      years: Number(o.years),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    const [pda] = await findNameRecordPda({ nameHash: hash });
    console.log(`  ${label}.${tld} -> ${pda}`);
  });

program
  .command("renew <name>")
  .description("Renew (extend) a name")
  .option("--years <n>", "term in years", "1")
  .action(async (name, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const { name: label, tld, hash } = nameParts(name);
    const [nameRecord] = await findNameRecordPda({ nameHash: hash });
    const ix = await getRenewNameInstructionAsync({
      payer: ctx.signer,
      nameRecord,
      payerTokenAccount: await ataFor(ctx.signer.address, cfg.data.paymentMint),
      treasuryTokenAccount: cfg.data.treasuryTokenAccount,
      paymentMint: cfg.data.paymentMint,
      name: label,
      tld,
      years: Number(o.years),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("claim <name>")
  .description("Claim a name that is past its expiry + grace period")
  .option("--years <n>", "term in years", "1")
  .action(async (name, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const { name: label, tld, hash } = nameParts(name);
    const [nameRecord] = await findNameRecordPda({ nameHash: hash });
    const ix = await getClaimExpiredInstructionAsync({
      claimer: ctx.signer,
      nameRecord,
      payerTokenAccount: await ataFor(ctx.signer.address, cfg.data.paymentMint),
      treasuryTokenAccount: cfg.data.treasuryTokenAccount,
      paymentMint: cfg.data.paymentMint,
      name: label,
      tld,
      years: Number(o.years),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

// --- records ---------------------------------------------------------------
const record = program.command("record").description("Manage a name's key -> value records");
record
  .command("set <name> <key> <value>")
  .description("Set (upsert) a record")
  .action(async (name, key, value, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const ix = getUpdateRecordInstruction({ authority: ctx.signer, nameRecord, key, value });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });
record
  .command("delete <name> <key>")
  .description("Delete a record")
  .action(async (name, key, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const ix = getUpdateRecordInstruction({ authority: ctx.signer, nameRecord, key, value: null });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

// --- management ------------------------------------------------------------
program
  .command("set-controller <name> <controller>")
  .description("Assign a controller delegate ('none' to clear)")
  .action(async (name, controller, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const value = controller.toLowerCase() === "none" ? null : address(controller);
    const ix = getSetControllerInstruction({ owner: ctx.signer, nameRecord, controller: value });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("set-resolver <name> <program>")
  .description("Set a custom resolver program ('none' to clear)")
  .action(async (name, resolver, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const value = resolver.toLowerCase() === "none" ? null : address(resolver);
    const ix = getSetResolverInstruction({ owner: ctx.signer, nameRecord, resolver: value });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("set-hosting <name> <cid>")
  .description("Set the hosting content ref ('none' to clear); owner or controller")
  .action(async (name, cid, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const value = cid.toLowerCase() === "none" ? null : cid;
    const ix = getSetHostingInstruction({ authority: ctx.signer, nameRecord, hostingRef: value });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("transfer <name> <newOwner>")
  .description("Transfer ownership of a name")
  .action(async (name, newOwner, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const ix = getTransferNameInstruction({ owner: ctx.signer, nameRecord, newOwner: address(newOwner) });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("lock <name>")
  .description("Lock (or --unlock) transfers for a name")
  .option("--unlock", "unlock instead of lock")
  .action(async (name, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const ix = getLockTransferInstruction({ owner: ctx.signer, nameRecord, lock: !o.unlock });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("set-reverse <name>")
  .description("Set the signer's reverse record to this name")
  .action(async (name, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const ix = await getSetReverseInstructionAsync({ owner: ctx.signer, nameRecord, name: normalizeName(name) });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("burn <name>")
  .description("Release a name and reclaim its rent")
  .action(async (name, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const ix = getBurnNameInstruction({ owner: ctx.signer, nameRecord });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

// --- reads -----------------------------------------------------------------
async function showRecord(ctx: Ctx, name: string, full: boolean) {
  const { name: label, tld, hash } = nameParts(name);
  const [pda] = await findNameRecordPda({ nameHash: hash });
  const d = await SolansClient.fromRpc(ctx.rpc).resolve(name);
  if (!d) {
    if (ctx.opts.json) console.log(JSON.stringify({ name: `${label}.${tld}`, registered: false }));
    else console.log(`${label}.${tld} is not registered`);
    return;
  }
  const out: Record<string, unknown> = {
    name: `${label}.${tld}`,
    pda,
    owner: d.owner,
    controller: unwrapOption(d.controller),
    expiresAt: new Date(Number(d.expiresAt) * 1000).toISOString(),
    transferLocked: d.transferLocked,
    reverseSet: d.reverseSet,
    resolver: unwrapOption(d.resolver),
    hostingRef: unwrapOption(d.hostingRef),
    records: d.records.map((r) => ({ key: r.key, value: r.value })),
  };
  if (full) {
    out.registeredAt = new Date(Number(d.registeredAt) * 1000).toISOString();
    out.nameHash = Buffer.from(d.nameHash).toString("hex");
    out.bump = d.bump;
  }
  if (ctx.opts.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`${out.name}`);
    console.log(`  pda:        ${pda}`);
    console.log(`  owner:      ${d.owner}`);
    console.log(`  controller: ${unwrapOption(d.controller) ?? "(none)"}`);
    console.log(`  expires:    ${out.expiresAt}`);
    console.log(`  locked:     ${d.transferLocked}   reverseSet: ${d.reverseSet}`);
    const resolver = unwrapOption(d.resolver);
    const hosting = unwrapOption(d.hostingRef);
    if (resolver) console.log(`  resolver:   ${resolver}`);
    if (hosting) console.log(`  hosting:    ${hosting}`);
    if (d.records.length === 0) console.log(`  records:    (none)`);
    else for (const r of d.records) console.log(`  record:     ${r.key} = ${r.value}`);
  }
}

program
  .command("resolve <name>")
  .description("Resolve a name -> owner, expiry, records")
  .action(async (name, _o, cmd) => {
    await showRecord(await makeContext(g(cmd)), name, false);
  });

program
  .command("info <name>")
  .description("Show the full name record")
  .action(async (name, _o, cmd) => {
    await showRecord(await makeContext(g(cmd)), name, true);
  });

program
  .command("reverse-lookup <pubkey>")
  .description("Resolve a wallet -> its primary name (round-trip validated)")
  .action(async (pubkey, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const name = await SolansClient.fromRpc(ctx.rpc).reverseLookup(address(pubkey));
    if (ctx.opts.json) console.log(JSON.stringify({ pubkey, name }));
    else console.log(name ? `${pubkey} -> ${name}` : `${pubkey} has no valid reverse record`);
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
