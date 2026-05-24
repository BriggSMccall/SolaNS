/**
 * Write-instruction builders — the shared, signer-agnostic composition layer the UI
 * (and any TS writer) uses to construct SOLANS transactions. Each builder mirrors the
 * exact account wiring the CLI uses, but returns plain instruction arrays so the caller
 * supplies the transport (a wallet `TransactionSendingSigner` in the browser, a keypair
 * in tests). This is what makes the web app's transactions litesvm-testable: the same
 * functions are exercised against the loaded program in `tx.test.ts`.
 *
 * Reads stay in `SolansClient`; these are the spec §3/§6/§9 *writes* the UI needs.
 */
import { generateKeyPairSigner, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  findNameRecordPda,
  getRegisterNameInstructionAsync,
  getRenewNameInstructionAsync,
  getSetHostingInstruction,
  getTokenizeNameInstructionAsync,
  getUpdateRecordInstruction,
  nameParts,
  type Config,
} from "@solans/client";

/** Derive the associated token account for (owner, mint). */
export async function ataFor(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

/** The price-tier + vault fields a fee-charging builder reads off the registry Config. */
type FeeConfig = Pick<Config, "paymentMint" | "treasuryTokenAccount" | "stakingVault" | "burnVault">;

export interface RegisterArgs {
  /** Pays the registration fee and is the transaction fee-payer. */
  payer: TransactionSigner;
  /** The registry Config (from `SolansClient.getConfig()`). */
  cfg: FeeConfig;
  /** Full name, e.g. `"alex.sol"`. */
  name: string;
  /** Owner of the name (default: the payer). `tokenize` only runs when owner === payer. */
  owner?: Address;
  years?: number;
  /** Referrer's token account (gets the §8.2 10% referral share). */
  referralTokenAccount?: Address;
  /** Mint the ownership NFT in the same tx (§6.1 default). Forced off when owner ≠ payer. */
  withNft?: boolean;
}

export interface RegisterResult {
  instructions: Instruction[];
  nameRecord: Address;
  /** The NFT mint address, when the name was tokenized in this tx. */
  nftMint?: Address;
}

/**
 * Build a registration: `register_name` (tiered fee, split 60/25/10/5) + — by default,
 * §6.1 — `tokenize_name` minting the 1-of-1 ownership NFT in the same tx. Matches the
 * CLI `register` default; `withNft:false` or a third-party `owner` opts out.
 */
export async function buildRegisterInstructions(args: RegisterArgs): Promise<RegisterResult> {
  const years = args.years ?? 1;
  const { name: label, tld, hash } = nameParts(args.name);
  const owner = args.owner ?? args.payer.address;
  const [nameRecord] = await findNameRecordPda({ nameHash: hash });

  const registerIx = await getRegisterNameInstructionAsync({
    payer: args.payer,
    owner,
    payerTokenAccount: await ataFor(args.payer.address, args.cfg.paymentMint),
    treasuryTokenAccount: args.cfg.treasuryTokenAccount,
    stakingVault: args.cfg.stakingVault,
    burnVault: args.cfg.burnVault,
    referralTokenAccount: args.referralTokenAccount,
    paymentMint: args.cfg.paymentMint,
    name: label,
    tld,
    nameHash: hash,
    years,
  });

  const instructions: Instruction[] = [registerIx];
  let nftMint: Address | undefined;
  if ((args.withNft ?? true) && owner === args.payer.address) {
    const mint = await generateKeyPairSigner();
    nftMint = mint.address;
    instructions.push(await getTokenizeNameInstructionAsync({ owner: args.payer, nameRecord, mint, name: label }));
  }
  return { instructions, nameRecord, nftMint };
}

export interface RenewArgs {
  payer: TransactionSigner;
  cfg: FeeConfig;
  name: string;
  years?: number;
  referralTokenAccount?: Address;
}

/** Build a `renew_name` (extends expiry; same tiered fee + split as register). */
export async function buildRenewInstructions(args: RenewArgs): Promise<Instruction[]> {
  const years = args.years ?? 1;
  const { name: label, tld, hash } = nameParts(args.name);
  const [nameRecord] = await findNameRecordPda({ nameHash: hash });
  return [
    await getRenewNameInstructionAsync({
      payer: args.payer,
      nameRecord,
      payerTokenAccount: await ataFor(args.payer.address, args.cfg.paymentMint),
      treasuryTokenAccount: args.cfg.treasuryTokenAccount,
      stakingVault: args.cfg.stakingVault,
      burnVault: args.cfg.burnVault,
      referralTokenAccount: args.referralTokenAccount,
      paymentMint: args.cfg.paymentMint,
      name: label,
      tld,
      years,
    }),
  ];
}

export interface RecordWriteArgs {
  /** The owner (or NFT holder) authorizing the change. */
  authority: TransactionSigner;
  nameRecord: Address;
  /**
   * The name's NFT mint when tokenized (§6 dynamic-attribute auth): the builder derives
   * the holder's `nftTokenAccount` so `name_authority_ok` passes. Omit for PDA-native names.
   */
  nftMint?: Address | null;
}

/** Build an `update_record` (set when `value` is a string, delete when `null`). */
export async function buildUpdateRecordInstructions(
  args: RecordWriteArgs & { key: string; value: string | null },
): Promise<Instruction[]> {
  const nftTokenAccount = args.nftMint ? await ataFor(args.authority.address, args.nftMint) : undefined;
  return [
    getUpdateRecordInstruction({
      authority: args.authority,
      nameRecord: args.nameRecord,
      nftTokenAccount,
      key: args.key,
      value: args.value,
    }),
  ];
}

/** Build a `set_hosting` (attach a content CID/TxId, or clear it with `null`). */
export async function buildSetHostingInstructions(
  args: RecordWriteArgs & { hostingRef: string | null },
): Promise<Instruction[]> {
  const nftTokenAccount = args.nftMint ? await ataFor(args.authority.address, args.nftMint) : undefined;
  return [
    getSetHostingInstruction({
      authority: args.authority,
      nameRecord: args.nameRecord,
      nftTokenAccount,
      hostingRef: args.hostingRef,
    }),
  ];
}
