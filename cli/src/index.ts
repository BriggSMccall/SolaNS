import { Command } from "commander";
import { address, generateKeyPairSigner, getAddressDecoder, unwrapOption } from "@solana/kit";
import {
  computeSubdomainHash,
  findAuction,
  findConfigPda,
  findListing,
  findNameRecordPda,
  findOffer,
  getAcceptOfferInstruction,
  getAutoRenewInstructionAsync,
  getBidInstruction,
  getCancelAuctionInstruction,
  getSettleAuctionInstructionAsync,
  getStartAuctionInstructionAsync,
  getBurnNameInstruction,
  getBuybackBurnInstructionAsync,
  getBuyNameInstruction,
  getCancelListingInstruction,
  getCancelOfferInstruction,
  getClaimExpiredInstructionAsync,
  getClaimRewardsInstructionAsync,
  getInitBurnPoolInstructionAsync,
  getInitConfigInstructionAsync,
  getInitStakePoolInstructionAsync,
  getListNameInstruction,
  getStakeInstructionAsync,
  getUnstakeInstructionAsync,
  getLockTransferInstruction,
  getMakeOfferInstruction,
  getRedeemNameInstructionAsync,
  getRegisterNameInstructionAsync,
  getRegisterWithSolansInstructionAsync,
  getRenewNameInstructionAsync,
  getRenewWithSolansInstructionAsync,
  getSetSolansParamsInstructionAsync,
  getRevokeSubdomainInstruction,
  getSetControllerInstruction,
  getSetHostingInstruction,
  getSetResolverInstruction,
  getSetReverseInstructionAsync,
  getTokenizeNameInstructionAsync,
  getTransferNameInstruction,
  getResolveInstruction,
  getTransferAdminInstructionAsync,
  getUpdateConfigInstructionAsync,
  getUpdateListingInstruction,
  getUpdateRecordInstruction,
  getWrapSubdomainInstructionAsync,
  nameHashFor,
  nameInfo,
  nameParts,
  normalizeName,
} from "@solans/client";
import { getApproveInstruction, getRevokeInstruction } from "@solana-program/token";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { hostingUrl, pinBytes, SolansClient } from "@solans/sdk";

/** Read `file` and pin it to IPFS via Pinata; returns the CID. */
async function pinFileToIpfs(jwt: string, file: string): Promise<string> {
  const bytes = new Uint8Array(await readFile(file));
  return pinBytes(jwt, bytes, basename(file));
}
import {
  ataFor,
  getConfig,
  makeContext,
  reportSig,
  sendInstructions,
  simulateReturnData,
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

/**
 * While a name is tokenized, record edits are authorized by NFT holdership, so
 * `update_record` needs the holder's token account. Returns the signer's ATA for
 * the NFT mint, or `undefined` when the name is not tokenized (owner-authorized).
 */
async function nftTokenAccountIfTokenized(ctx: Ctx, name: string) {
  const rec = await SolansClient.fromRpc(ctx.rpc).resolve(name);
  const mint = rec ? unwrapOption(rec.nftMint) : null;
  return mint ? await ataFor(ctx.signer.address, mint) : undefined;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;
/** Parse a decimal SOL string (e.g. "1.5") into integer lamports. */
function solToLamports(sol: string): bigint {
  const [whole, frac = ""] = sol.trim().split(".");
  return BigInt(whole || "0") * LAMPORTS_PER_SOL + BigInt((frac + "000000000").slice(0, 9));
}
const lamportsToSol = (l: bigint) => (Number(l) / Number(LAMPORTS_PER_SOL)).toString();

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
  .option("--price-numeric <baseUnits>", "premium ≤4-digit numeric price / year", "500000000")
  .option("--grace <seconds>", "grace period before claim", "7776000")
  .option("--min-years <n>", "minimum term", "1")
  .option("--max-years <n>", "maximum term", "10")
  .option("--sol-treasury <address>", "wallet receiving SOL marketplace fees (default: signer)")
  .option("--fee-bps <bps>", "marketplace fee in basis points (max 1000)", "200")
  .option("--staking-vault <address>", "token account for the §8.2 staker share (default: treasury)")
  .option("--burn-vault <address>", "token account for the §8.2 burn share (default: treasury)")
  .option("--staking-bps <bps>", "staker fee share, bps", "2500")
  .option("--referral-bps <bps>", "referral fee share, bps", "1000")
  .option("--burn-bps <bps>", "burn fee share, bps", "500")
  .action(async (o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const ix = await getInitConfigInstructionAsync({
      admin: ctx.signer,
      paymentMint: address(o.mint),
      treasuryTokenAccount: address(o.treasury),
      stakingVault: o.stakingVault ? address(o.stakingVault) : address(o.treasury),
      burnVault: o.burnVault ? address(o.burnVault) : address(o.treasury),
      price1: BigInt(o.price1),
      price2: BigInt(o.price2),
      price3: BigInt(o.price3),
      price4: BigInt(o.price4),
      price5plus: BigInt(o.price5),
      priceNumeric: BigInt(o.priceNumeric),
      gracePeriodSeconds: BigInt(o.grace),
      minYears: Number(o.minYears),
      maxYears: Number(o.maxYears),
      solTreasury: o.solTreasury ? address(o.solTreasury) : ctx.signer.address,
      marketplaceFeeBps: Number(o.feeBps),
      stakingFeeBps: Number(o.stakingBps),
      referralFeeBps: Number(o.referralBps),
      burnFeeBps: Number(o.burnBps),
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
  .option("--price-numeric <baseUnits>", "premium ≤4-digit numeric price / year")
  .option("--grace <seconds>", "grace period before claim")
  .option("--min-years <n>", "minimum term")
  .option("--max-years <n>", "maximum term")
  .option("--sol-treasury <address>", "wallet receiving SOL marketplace fees")
  .option("--fee-bps <bps>", "marketplace fee in basis points (max 1000)")
  .option("--staking-bps <bps>", "staker fee share, bps")
  .option("--referral-bps <bps>", "referral fee share, bps")
  .option("--burn-bps <bps>", "burn fee share, bps")
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
      priceNumeric: o.priceNumeric ? BigInt(o.priceNumeric) : d.priceNumeric,
      gracePeriodSeconds: o.grace ? BigInt(o.grace) : d.gracePeriodSeconds,
      minYears: o.minYears ? Number(o.minYears) : d.minYears,
      maxYears: o.maxYears ? Number(o.maxYears) : d.maxYears,
      solTreasury: o.solTreasury ? address(o.solTreasury) : d.solTreasury,
      marketplaceFeeBps: o.feeBps ? Number(o.feeBps) : d.marketplaceFeeBps,
      stakingFeeBps: o.stakingBps ? Number(o.stakingBps) : d.stakingFeeBps,
      referralFeeBps: o.referralBps ? Number(o.referralBps) : d.referralFeeBps,
      burnFeeBps: o.burnBps ? Number(o.burnBps) : d.burnFeeBps,
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("transfer-admin <newAdmin>")
  .description("Rotate the config admin authority, e.g. to a multisig/DAO (admin)")
  .action(async (newAdmin, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const ix = await getTransferAdminInstructionAsync({ admin: ctx.signer, newAdmin: address(newAdmin) });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    console.log(`  admin -> ${newAdmin}`);
  });

// --- register / renew / claim ----------------------------------------------
program
  .command("register <name>")
  .description("Register a name as a tradeable NFT (pays the tiered fee, split 60/25/10/5 per §8.2)")
  .option("--owner <address>", "owner of the name (default: signer)")
  .option("--years <n>", "term in years", "1")
  .option("--referrer <tokenAccount>", "referrer's token account (gets the 10% referral share)")
  .option("--pay-solans", "pay the fee in $SOLANS at the §8.1 discount (burned on the spot)")
  .option("--no-nft", "skip minting the ownership NFT (register PDA-native only)")
  .action(async (name, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const { name: label, tld, hash } = nameParts(name);
    const owner = o.owner ? address(o.owner) : ctx.signer.address;
    const [nameRecord] = await findNameRecordPda({ nameHash: hash });
    const registerIx = o.paySolans
      ? await getRegisterWithSolansInstructionAsync({
          payer: ctx.signer,
          owner,
          payerSolansAccount: await ataFor(ctx.signer.address, cfg.data.solansMint),
          solansMint: cfg.data.solansMint,
          name: label,
          tld,
          nameHash: hash,
          years: Number(o.years),
        })
      : await getRegisterNameInstructionAsync({
          payer: ctx.signer,
          owner,
          payerTokenAccount: await ataFor(ctx.signer.address, cfg.data.paymentMint),
          treasuryTokenAccount: cfg.data.treasuryTokenAccount,
          stakingVault: cfg.data.stakingVault,
          burnVault: cfg.data.burnVault,
          referralTokenAccount: o.referrer ? address(o.referrer) : undefined,
          paymentMint: cfg.data.paymentMint,
          name: label,
          tld,
          nameHash: hash,
          years: Number(o.years),
        });
    // §6.1: a name IS an NFT. By default mint the 1-of-1 in the same tx, so the
    // registrant gets a tradeable certificate. Only possible when registering to
    // self (tokenize is owner-gated); `--no-nft` or `--owner <other>` opts out.
    const mintNft = o.nft !== false && owner === ctx.signer.address;
    const ixs: unknown[] = [registerIx];
    if (mintNft) {
      const mint = await generateKeyPairSigner();
      ixs.push(await getTokenizeNameInstructionAsync({ owner: ctx.signer, nameRecord, mint, name: label }));
    }
    reportSig(ctx, await sendInstructions(ctx, ixs));
    console.log(`  ${label}.${tld} -> ${nameRecord}${mintNft ? " (NFT minted)" : ""}`);
  });

program
  .command("renew <name>")
  .description("Renew (extend) a name")
  .option("--years <n>", "term in years", "1")
  .option("--referrer <tokenAccount>", "referrer's token account (gets the 10% referral share)")
  .option("--pay-solans", "pay the fee in $SOLANS at the §8.1 discount (burned on the spot)")
  .action(async (name, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const { name: label, tld, hash } = nameParts(name);
    const [nameRecord] = await findNameRecordPda({ nameHash: hash });
    const ix = o.paySolans
      ? await getRenewWithSolansInstructionAsync({
          payer: ctx.signer,
          nameRecord,
          payerSolansAccount: await ataFor(ctx.signer.address, cfg.data.solansMint),
          solansMint: cfg.data.solansMint,
          name: label,
          tld,
          years: Number(o.years),
        })
      : await getRenewNameInstructionAsync({
          payer: ctx.signer,
          nameRecord,
          payerTokenAccount: await ataFor(ctx.signer.address, cfg.data.paymentMint),
          treasuryTokenAccount: cfg.data.treasuryTokenAccount,
          stakingVault: cfg.data.stakingVault,
          burnVault: cfg.data.burnVault,
          referralTokenAccount: o.referrer ? address(o.referrer) : undefined,
          paymentMint: cfg.data.paymentMint,
          name: label,
          tld,
          years: Number(o.years),
        });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("auto-renew-enable <amount>")
  .description("Approve the Config PDA as delegate to auto-renew your names (§6.2); covers `amount` base units")
  .action(async (amount, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const [config] = await findConfigPda();
    const ix = getApproveInstruction({
      source: await ataFor(ctx.signer.address, cfg.data.paymentMint),
      delegate: config,
      owner: ctx.signer,
      amount: BigInt(amount),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    console.log(`  auto-renew enabled (delegated ${amount} to the Config PDA)`);
  });

program
  .command("auto-renew-disable")
  .description("Revoke the auto-renew delegation on your payment account (§6.2)")
  .action(async (_o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const ix = getRevokeInstruction({
      source: await ataFor(ctx.signer.address, cfg.data.paymentMint),
      owner: ctx.signer,
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("auto-renew <name>")
  .description("Keeper: auto-renew a name from the owner's delegated funds (§6.2)")
  .option("--years <n>", "term in years", "1")
  .action(async (name, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const { name: label, tld, hash } = nameParts(name);
    const rec = await SolansClient.fromRpc(ctx.rpc).resolve(name);
    if (!rec) throw new Error(`${name} is not registered`);
    const [nameRecord] = await findNameRecordPda({ nameHash: hash });
    const ix = await getAutoRenewInstructionAsync({
      keeper: ctx.signer,
      nameRecord,
      ownerTokenAccount: await ataFor(rec.owner, cfg.data.paymentMint),
      treasuryTokenAccount: cfg.data.treasuryTokenAccount,
      stakingVault: cfg.data.stakingVault,
      burnVault: cfg.data.burnVault,
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
  .option("--referrer <tokenAccount>", "referrer's token account (gets the 10% referral share)")
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
      stakingVault: cfg.data.stakingVault,
      burnVault: cfg.data.burnVault,
      referralTokenAccount: o.referrer ? address(o.referrer) : undefined,
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
  .description("Set (upsert) a record (owner, controller, or NFT holder if tokenized)")
  .action(async (name, key, value, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const nftTokenAccount = await nftTokenAccountIfTokenized(ctx, name);
    const ix = getUpdateRecordInstruction({ authority: ctx.signer, nameRecord, key, value, nftTokenAccount });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });
record
  .command("delete <name> <key>")
  .description("Delete a record (owner, controller, or NFT holder if tokenized)")
  .action(async (name, key, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const nftTokenAccount = await nftTokenAccountIfTokenized(ctx, name);
    const ix = getUpdateRecordInstruction({ authority: ctx.signer, nameRecord, key, value: null, nftTokenAccount });
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
  .description("Set a custom resolver program ('none' to clear); owner or NFT holder")
  .action(async (name, resolver, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const nftTokenAccount = await nftTokenAccountIfTokenized(ctx, name);
    const value = resolver.toLowerCase() === "none" ? null : address(resolver);
    const ix = getSetResolverInstruction({ authority: ctx.signer, nameRecord, resolver: value, nftTokenAccount });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("set-hosting <name> <cid>")
  .description("Set the hosting content ref ('none' to clear); owner, controller, or NFT holder")
  .action(async (name, cid, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const nftTokenAccount = await nftTokenAccountIfTokenized(ctx, name);
    const value = cid.toLowerCase() === "none" ? null : cid;
    const ix = getSetHostingInstruction({ authority: ctx.signer, nameRecord, hostingRef: value, nftTokenAccount });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("host <name>")
  .description("Show a name's hosted-content ref + the resolved gateway URL (§6)")
  .action(async (name, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const sdk = SolansClient.fromRpc(ctx.rpc);
    const ref = await sdk.contentRef(name);
    if (!ref) {
      console.log(`${name}: no hosted content`);
      return;
    }
    const url = hostingUrl(ref);
    if (ctx.opts.json) console.log(JSON.stringify({ name, ref, url }, null, 2));
    else {
      console.log(`  ref: ${ref}`);
      console.log(`  url: ${url ?? "(unsupported ref)"}`);
    }
  });

program
  .command("host-upload <name> <file>")
  .description("Pin a file to IPFS via Pinata (env PINATA_JWT) and set it as the name's hosting ref")
  .action(async (name, file, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const jwt = process.env.PINATA_JWT;
    if (!jwt) throw new Error("set PINATA_JWT to pin to IPFS (https://pinata.cloud)");
    const cid = await pinFileToIpfs(jwt, file);
    const ref = `ipfs://${cid}`;
    const [nameRecord] = await nameRecordPda(name);
    const nftTokenAccount = await nftTokenAccountIfTokenized(ctx, name);
    const ix = getSetHostingInstruction({ authority: ctx.signer, nameRecord, hostingRef: ref, nftTokenAccount });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    console.log(`  pinned ${file} -> ${ref}`);
    console.log(`  url: ${hostingUrl(ref)}`);
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

// --- NFT (tokenize / redeem) -----------------------------------------------
program
  .command("tokenize <name>")
  .description("Mint the name as a tradeable 1-of-1 NFT (owner only)")
  .action(async (name, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const { name: label, tld, hash } = nameParts(name);
    const [nameRecord] = await findNameRecordPda({ nameHash: hash });
    // A fresh mint keypair signs its own creation; codama derives the ATA,
    // metadata, master-edition, and program accounts from the name's seeds.
    const mint = await generateKeyPairSigner();
    const ix = await getTokenizeNameInstructionAsync({
      owner: ctx.signer,
      nameRecord,
      mint,
      name: label,
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    console.log(`  ${label}.${tld} tokenized -> NFT mint ${mint.address}`);
  });

program
  .command("redeem <name>")
  .description("Burn the name's NFT and restore direct ownership (NFT holder)")
  .action(async (name, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const rec = await SolansClient.fromRpc(ctx.rpc).resolve(name);
    const mint = rec ? unwrapOption(rec.nftMint) : null;
    if (!mint) throw new Error(`${name} is not tokenized`);
    const ix = await getRedeemNameInstructionAsync({
      redeemer: ctx.signer,
      nameRecord,
      mint,
      tokenAccount: await ataFor(ctx.signer.address, mint),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    console.log(`  ${name} redeemed -> owner ${ctx.signer.address}`);
  });

// --- subdomains ------------------------------------------------------------
const subdomain = program.command("subdomain").description("Manage subdomains (pay.alex.sol)");
subdomain
  .command("create <parent> <label>")
  .description("Create a subdomain under a parent name (parent owner)")
  .option("--owner <address>", "subdomain owner (default: signer)")
  .action(async (parent, label, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const p = nameInfo(parent);
    const childLabel = label.toLowerCase();
    const childHash = computeSubdomainHash(p.hash, childLabel);
    const [parentName] = await findNameRecordPda({ nameHash: p.hash });
    const ix = await getWrapSubdomainInstructionAsync({
      owner: ctx.signer,
      subdomainOwner: o.owner ? address(o.owner) : ctx.signer.address,
      parentName,
      label: childLabel,
      nameHash: childHash,
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    const [childPda] = await findNameRecordPda({ nameHash: childHash });
    console.log(`  ${childLabel}.${p.labels.join(".")}.${p.tld} -> ${childPda}`);
  });
subdomain
  .command("revoke <parent> <label>")
  .description("Revoke (close) a subdomain and reclaim its rent (parent owner)")
  .action(async (parent, label, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const p = nameInfo(parent);
    const childHash = computeSubdomainHash(p.hash, label.toLowerCase());
    const [parentName] = await findNameRecordPda({ nameHash: p.hash });
    const [nameRecord] = await findNameRecordPda({ nameHash: childHash });
    const ix = getRevokeSubdomainInstruction({ owner: ctx.signer, parentName, nameRecord });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

// --- marketplace -----------------------------------------------------------
program
  .command("list <name> <priceSol>")
  .description("List a name for sale at a fixed SOL price (owner)")
  .option("--days <n>", "listing duration in days", "30")
  .action(async (name, priceSol, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const [listing] = await findListing(name);
    const ix = getListNameInstruction({
      owner: ctx.signer,
      nameRecord,
      listing,
      price: solToLamports(priceSol),
      durationSeconds: BigInt(Math.round(Number(o.days) * 86_400)),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    console.log(`  listed ${name} for ${priceSol} SOL`);
  });

program
  .command("unlist <name>")
  .description("Cancel a listing (seller, or anyone once it has expired)")
  .action(async (name, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const [listing] = await findListing(name);
    const l = await SolansClient.fromRpc(ctx.rpc).getListing(name);
    if (!l) throw new Error(`${name} is not listed`);
    const ix = getCancelListingInstruction({ canceller: ctx.signer, seller: l.seller, nameRecord, listing });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("update-listing <name> <priceSol>")
  .description("Reprice / re-extend a listing (seller)")
  .option("--days <n>", "new listing duration in days", "30")
  .action(async (name, priceSol, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [listing] = await findListing(name);
    const ix = getUpdateListingInstruction({
      seller: ctx.signer,
      listing,
      price: solToLamports(priceSol),
      durationSeconds: BigInt(Math.round(Number(o.days) * 86_400)),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("buy <name>")
  .description("Buy a listed name (pays the listed SOL price)")
  .action(async (name, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const [listing] = await findListing(name);
    const l = await SolansClient.fromRpc(ctx.rpc).getListing(name);
    if (!l) throw new Error(`${name} is not listed`);
    const cfg = await getConfig(ctx);
    const ix = getBuyNameInstruction({
      buyer: ctx.signer,
      seller: l.seller,
      solTreasury: cfg.data.solTreasury,
      config: cfg.address,
      nameRecord,
      listing,
      expectedPrice: l.price,
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    console.log(`  bought ${name} for ${lamportsToSol(l.price)} SOL`);
  });

program
  .command("offer <name> <priceSol>")
  .description("Make a SOL offer on a name (escrows the bid)")
  .option("--days <n>", "offer duration in days", "30")
  .action(async (name, priceSol, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const [offer] = await findOffer(name, ctx.signer.address);
    const ix = getMakeOfferInstruction({
      buyer: ctx.signer,
      nameRecord,
      offer,
      amount: solToLamports(priceSol),
      durationSeconds: BigInt(Math.round(Number(o.days) * 86_400)),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    console.log(`  offered ${priceSol} SOL on ${name}`);
  });

program
  .command("accept-offer <name> <buyer>")
  .description("Accept a bidder's offer (owner): sell the name for the escrowed SOL")
  .action(async (name, buyer, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const [nameRecord] = await nameRecordPda(name);
    const [offer] = await findOffer(name, address(buyer));
    const cfg = await getConfig(ctx);
    const ix = getAcceptOfferInstruction({
      owner: ctx.signer,
      buyer: address(buyer),
      solTreasury: cfg.data.solTreasury,
      config: cfg.address,
      nameRecord,
      offer,
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    console.log(`  accepted ${buyer}'s offer on ${name}`);
  });

program
  .command("cancel-offer <name>")
  .description("Cancel/reject an offer (bidder, owner, or anyone if expired); refunds the bidder")
  .option("--buyer <address>", "the bidder (default: signer)")
  .action(async (name, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const bidder = o.buyer ? address(o.buyer) : ctx.signer.address;
    const [nameRecord] = await nameRecordPda(name);
    const [offer] = await findOffer(name, bidder);
    const ix = getCancelOfferInstruction({ canceller: ctx.signer, buyer: bidder, nameRecord, offer });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

// --- auctions (English, $SOLANS bids, §9.1) --------------------------------
program
  .command("auction-start <name>")
  .description("Open an English $SOLANS auction on a name (owner)")
  .requiredOption("--reserve <baseUnits>", "minimum first bid ($SOLANS base units)")
  .option("--increment <baseUnits>", "minimum raise over the highest bid", "1")
  .option("--days <n>", "auction duration in days", "3")
  .action(async (name, o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const [nameRecord] = await nameRecordPda(name);
    const [auction] = await findAuction(name);
    const ix = await getStartAuctionInstructionAsync({
      owner: ctx.signer,
      nameRecord,
      auction,
      solansMint: cfg.data.solansMint,
      reservePrice: BigInt(o.reserve),
      minIncrement: BigInt(o.increment),
      durationSeconds: BigInt(Math.round(Number(o.days) * 86_400)),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    console.log(`  auction open for ${name} (reserve ${o.reserve} $SOLANS)`);
  });

program
  .command("bid <name> <amount>")
  .description("Bid on a live auction ($SOLANS base units; outbids refund the prior bidder)")
  .action(async (name, amount, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const solansMint = cfg.data.solansMint;
    const [auction] = await findAuction(name);
    const a = await SolansClient.fromRpc(ctx.rpc).getAuction(name);
    if (!a) throw new Error(`no auction for ${name}`);
    const prev = unwrapOption(a.highestBidder);
    const ix = getBidInstruction({
      bidder: ctx.signer,
      auction,
      bidderSolansAccount: await ataFor(ctx.signer.address, solansMint),
      prevBidderSolansAccount: prev ? await ataFor(prev, solansMint) : undefined,
      bidVault: await ataFor(auction, solansMint),
      solansMint,
      amount: BigInt(amount),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("auction-settle <name>")
  .description("Settle a finished auction (anyone): transfer the name, pay the seller, burn the fee")
  .action(async (name, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const solansMint = cfg.data.solansMint;
    const [nameRecord] = await nameRecordPda(name);
    const [auction] = await findAuction(name);
    const a = await SolansClient.fromRpc(ctx.rpc).getAuction(name);
    if (!a) throw new Error(`no auction for ${name}`);
    const winner = unwrapOption(a.highestBidder);
    const ix = await getSettleAuctionInstructionAsync({
      settler: ctx.signer,
      seller: a.seller,
      sellerSolansAccount: winner ? await ataFor(a.seller, solansMint) : undefined,
      nameRecord,
      auction,
      bidVault: await ataFor(auction, solansMint),
      solansMint,
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
    console.log(winner ? `  ${name} -> ${winner}` : `  ${name} unsold (no bids)`);
  });

program
  .command("auction-cancel <name>")
  .description("Cancel an auction before any bid (seller)")
  .action(async (name, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const [nameRecord] = await nameRecordPda(name);
    const [auction] = await findAuction(name);
    const ix = getCancelAuctionInstruction({
      seller: ctx.signer,
      nameRecord,
      auction,
      bidVault: await ataFor(auction, cfg.data.solansMint),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("auction-info <name>")
  .description("Show a name's auction (seller, highest bid, end time)")
  .action(async (name, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const a = await SolansClient.fromRpc(ctx.rpc).getAuction(name);
    if (!a) {
      console.log("no auction");
      return;
    }
    const bidder = unwrapOption(a.highestBidder);
    const out = {
      seller: a.seller,
      highestBidder: bidder ?? null,
      highestBid: a.highestBid.toString(),
      reservePrice: a.reservePrice.toString(),
      minIncrement: a.minIncrement.toString(),
      endTime: a.endTime.toString(),
    };
    if (ctx.opts.json) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(`  seller:    ${out.seller}`);
      console.log(`  highest:   ${out.highestBid} by ${out.highestBidder ?? "(none)"}`);
      console.log(`  reserve:   ${out.reservePrice} (+${out.minIncrement} increment)`);
      console.log(`  ends at:   ${out.endTime}`);
    }
  });

// --- staking ($SOLANS) -----------------------------------------------------
program
  .command("stake-init <solansMint>")
  .description("Create the $SOLANS staking pool (admin); points the staker fee share at it")
  .action(async (solansMint, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const ix = await getInitStakePoolInstructionAsync({
      admin: ctx.signer,
      solansMint: address(solansMint),
      paymentMint: cfg.data.paymentMint,
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

async function stakePoolAndConfig(ctx: Ctx) {
  const cfg = await getConfig(ctx);
  const pool = await SolansClient.fromRpc(ctx.rpc).getStakePool();
  if (!pool) throw new Error("staking pool not initialized (run stake-init)");
  return { cfg, pool };
}

program
  .command("stake <amount>")
  .description("Stake $SOLANS to earn the protocol fee share")
  .action(async (amount, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const { cfg, pool } = await stakePoolAndConfig(ctx);
    const ix = await getStakeInstructionAsync({
      staker: ctx.signer,
      stakerTokenAccount: await ataFor(ctx.signer.address, pool.solansMint),
      stakerRewardAccount: await ataFor(ctx.signer.address, cfg.data.paymentMint),
      stakeVault: pool.stakeVault,
      rewardVault: pool.rewardVault,
      solansMint: pool.solansMint,
      paymentMint: cfg.data.paymentMint,
      amount: BigInt(amount),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("unstake <amount>")
  .description("Withdraw staked $SOLANS (pays out pending reward first)")
  .action(async (amount, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const { cfg, pool } = await stakePoolAndConfig(ctx);
    const ix = await getUnstakeInstructionAsync({
      staker: ctx.signer,
      stakerTokenAccount: await ataFor(ctx.signer.address, pool.solansMint),
      stakerRewardAccount: await ataFor(ctx.signer.address, cfg.data.paymentMint),
      stakeVault: pool.stakeVault,
      rewardVault: pool.rewardVault,
      solansMint: pool.solansMint,
      paymentMint: cfg.data.paymentMint,
      amount: BigInt(amount),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("stake-claim")
  .description("Claim pending staking rewards (payment mint)")
  .action(async (_o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const { cfg, pool } = await stakePoolAndConfig(ctx);
    const ix = await getClaimRewardsInstructionAsync({
      staker: ctx.signer,
      stakerRewardAccount: await ataFor(ctx.signer.address, cfg.data.paymentMint),
      rewardVault: pool.rewardVault,
      paymentMint: cfg.data.paymentMint,
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("stake-info")
  .description("Show the staking pool + the signer's stake + pending reward")
  .action(async (_o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const sdk = SolansClient.fromRpc(ctx.rpc);
    const pool = await sdk.getStakePool();
    if (!pool) {
      console.log("staking pool not initialized");
      return;
    }
    const stake = await sdk.getStake(ctx.signer.address);
    const pending = await sdk.pendingReward(ctx.signer.address);
    const out = {
      totalStaked: pool.totalStaked.toString(),
      myStake: (stake?.amount ?? 0n).toString(),
      pendingReward: pending.toString(),
    };
    if (ctx.opts.json) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(`  total staked: ${out.totalStaked}`);
      console.log(`  my stake:     ${out.myStake}`);
      console.log(`  pending:      ${out.pendingReward}`);
    }
  });

// --- $SOLANS buyback / pay-in (§8.1) ---------------------------------------
program
  .command("burn-init <solansMint>")
  .description("Create the Config-owned buyback burn vault + record the $SOLANS mint (admin)")
  .action(async (solansMint, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const ix = await getInitBurnPoolInstructionAsync({
      admin: ctx.signer,
      solansMint: address(solansMint),
      paymentMint: cfg.data.paymentMint,
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("solans-params")
  .description("Set the §8.1 pay-in-$SOLANS rate + discount (admin)")
  .requiredOption("--rate <baseUnits>", "$SOLANS base units per 1 payment-mint base unit (×1e6)")
  .requiredOption("--discount-bps <bps>", "pay-in discount, basis points (< 10000)")
  .action(async (o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const ix = await getSetSolansParamsInstructionAsync({
      admin: ctx.signer,
      solansRate: BigInt(o.rate),
      solansDiscountBps: Number(o.discountBps),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

program
  .command("buyback <solansAmount>")
  .description("Burn $SOLANS and drain the burn vault in exchange (§8.1, permissionless keeper)")
  .action(async (solansAmount, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const cfg = await getConfig(ctx);
    const ix = await getBuybackBurnInstructionAsync({
      keeper: ctx.signer,
      burnVault: cfg.data.burnVault,
      keeperPaymentAccount: await ataFor(ctx.signer.address, cfg.data.paymentMint),
      keeperSolansAccount: await ataFor(ctx.signer.address, cfg.data.solansMint),
      solansMint: cfg.data.solansMint,
      paymentMint: cfg.data.paymentMint,
      solansAmount: BigInt(solansAmount),
    });
    reportSig(ctx, await sendInstructions(ctx, [ix]));
  });

// --- reads -----------------------------------------------------------------
async function showRecord(ctx: Ctx, name: string, full: boolean) {
  const info = nameInfo(name);
  const fullName = `${info.labels.join(".")}.${info.tld}`;
  const [pda] = await findNameRecordPda({ nameHash: info.hash });
  const d = await SolansClient.fromRpc(ctx.rpc).resolve(name);
  if (!d) {
    if (ctx.opts.json) console.log(JSON.stringify({ name: fullName, registered: false }));
    else console.log(`${fullName} is not registered`);
    return;
  }
  const out: Record<string, unknown> = {
    name: fullName,
    pda,
    owner: d.owner,
    controller: unwrapOption(d.controller),
    expiresAt: new Date(Number(d.expiresAt) * 1000).toISOString(),
    transferLocked: d.transferLocked,
    reverseSet: d.reverseSet,
    resolver: unwrapOption(d.resolver),
    hostingRef: unwrapOption(d.hostingRef),
    tokenized: unwrapOption(d.nftMint) !== null,
    nftMint: unwrapOption(d.nftMint),
    parent: unwrapOption(d.parent),
    depth: d.depth,
    listed: d.listed,
    records: d.records.map((r) => ({ key: r.key, value: r.value })),
  };
  const listing = d.listed ? await SolansClient.fromRpc(ctx.rpc).getListing(name) : null;
  if (listing) {
    out.listingPriceSol = lamportsToSol(listing.price);
    out.listingExpiresAt = new Date(Number(listing.expiresAt) * 1000).toISOString();
  }
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
    const nftMint = unwrapOption(d.nftMint);
    const parent = unwrapOption(d.parent);
    if (parent) console.log(`  parent:     ${parent}   (depth ${d.depth})`);
    if (resolver) console.log(`  resolver:   ${resolver}`);
    if (hosting) console.log(`  hosting:    ${hosting}`);
    if (nftMint) console.log(`  tokenized:  NFT mint ${nftMint}`);
    if (listing) console.log(`  listed:     ${lamportsToSol(listing.price)} SOL (until ${out.listingExpiresAt})`);
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
  .command("resolve-cpi <name> [key]")
  .description("Resolve a name on-chain via the §5.2 CPI resolver (reads return_data)")
  .action(async (name, key, _o, cmd) => {
    const ctx = await makeContext(g(cmd));
    const { hash } = nameParts(name);
    const [nameRecord] = await findNameRecordPda({ nameHash: hash });
    const ix = getResolveInstruction({ nameRecord, nameHash: hash, recordKey: key ?? null });
    const data = await simulateReturnData(ctx, [ix]);
    if (!data || data.length === 0) {
      console.log(key ? `  ${key}: (unset)` : "  (no data)");
      return;
    }
    if (key) console.log(`  ${key}: ${new TextDecoder().decode(data)}`);
    else console.log(`  owner: ${getAddressDecoder().decode(data)}`);
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
