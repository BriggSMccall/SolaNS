import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { Clock, FailedTransactionMetadata, LiteSVM, type TransactionMetadata } from "litesvm";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintToInstruction,
  getTokenDecoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  computeSubdomainHash,
  decodeConfig,
  decodeNameRecord,
  decodeReverseRecord,
  findConfigPda,
  findListing,
  findNameRecordPda,
  findOffer,
  findStakePoolPda,
  getAcceptOfferInstruction,
  getBuyNameInstruction,
  getInitConfigInstructionAsync,
  getInitStakePoolInstructionAsync,
  getListNameInstruction,
  getMakeOfferInstruction,
  getRegisterNameInstructionAsync,
  getWrapSubdomainInstructionAsync,
  nameInfo,
  nameParts,
  SOLANS_PROGRAM_ADDRESS,
} from "@solans/client";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROGRAM_SO = path.resolve(HERE, "../../target/deploy/solans.so");
const MPL_SO = path.resolve(HERE, "../fixtures/mpl_token_metadata.so");

/** Metaplex Token Metadata program ID (loaded from a committed mainnet dump). */
export const MPL_PROGRAM_ADDRESS = address("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const MAX_U64 = 18446744073709551615n;

export type TestEnv = {
  svm: LiteSVM;
  payer: KeyPairSigner;
  mint: Address;
  payerAta: Address;
  treasury: Address;
  treasuryOwner: Address;
  /** Wallet that receives native-SOL marketplace fees. */
  solTreasury: Address;
  /** Token account (payment mint) accumulating the stakers' fee share (§8.2). */
  stakingVault: Address;
  /** Token account (payment mint) accumulating the burn fee share (§8.2). */
  burnVault: Address;
};

/** Marketplace fee in basis points configured by `setupEnv` (2%). */
export const MARKETPLACE_FEE_BPS = 200;
/** Per-year price for a premium numeric name configured by `setupEnv`. */
export const PRICE_NUMERIC = 500_000_000n;
/** §8.2 fee-split basis points configured by `setupEnv` (treasury gets the remainder, 60%). */
export const STAKING_FEE_BPS = 2500;
export const REFERRAL_FEE_BPS = 1000;
export const BURN_FEE_BPS = 500;

/** Build, sign, and send a transaction; throws on on-chain failure. */
export async function send(
  svm: LiteSVM,
  feePayer: KeyPairSigner,
  instructions: readonly any[],
): Promise<TransactionMetadata> {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: svm.latestBlockhash(), lastValidBlockHeight: MAX_U64 }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const res = svm.sendTransaction(signed);
  svm.expireBlockhash();
  if (res instanceof FailedTransactionMetadata) {
    throw new Error(`tx failed: ${res.toString()}\n${res.meta().logs().join("\n")}`);
  }
  return res;
}

/** Build, sign, and send a transaction expected to fail; returns the failure. */
export async function sendExpectingFailure(
  svm: LiteSVM,
  feePayer: KeyPairSigner,
  instructions: readonly any[],
): Promise<FailedTransactionMetadata> {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: svm.latestBlockhash(), lastValidBlockHeight: MAX_U64 }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const res = svm.sendTransaction(signed);
  svm.expireBlockhash();
  if (!(res instanceof FailedTransactionMetadata)) {
    throw new Error("expected the transaction to fail, but it succeeded");
  }
  return res;
}

export function logsOf(res: FailedTransactionMetadata): string {
  return [res.toString(), ...res.meta().logs()].join("\n");
}

// --- account reads ---------------------------------------------------------
export function readName(svm: LiteSVM, pda: Address) {
  const a = svm.getAccount(pda);
  return a.exists ? decodeNameRecord(a).data : null;
}
export function readReverse(svm: LiteSVM, pda: Address) {
  const a = svm.getAccount(pda);
  return a.exists ? decodeReverseRecord(a).data : null;
}
export function readConfig(svm: LiteSVM, pda: Address) {
  const a = svm.getAccount(pda);
  return a.exists ? decodeConfig(a).data : null;
}
/** Amount held by an SPL token account, or null if the account is absent/closed. */
export function readTokenAmount(svm: LiteSVM, ata: Address): bigint | null {
  const a = svm.getAccount(ata);
  if (!a.exists || a.data.length === 0) return null;
  return getTokenDecoder().decode(a.data).amount;
}
/** Whether an account currently exists (non-empty) — for asserting closes. */
export function accountExists(svm: LiteSVM, addr: Address): boolean {
  const a = svm.getAccount(addr);
  return a.exists && a.data.length > 0;
}

/** Warp the validator clock to a given unix timestamp (for expiry tests). */
export function warpToUnixTimestamp(svm: LiteSVM, unixTimestamp: bigint): void {
  const c = svm.getClock();
  svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, unixTimestamp));
}

export function unixNow(svm: LiteSVM): bigint {
  return svm.getClock().unixTimestamp;
}

/** Fund a fresh signer with SOL so it can pay fees. */
export async function fundedSigner(svm: LiteSVM, sol = 100n): Promise<KeyPairSigner> {
  const s = await generateKeyPairSigner();
  svm.airdrop(s.address, lamports(sol * 1_000_000_000n));
  return s;
}

/** Mint test tokens to `owner`'s ATA and return the ATA address. */
export async function mintTokensTo(
  env: TestEnv,
  owner: Address,
  amount: bigint,
): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: env.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: env.payer,
    owner,
    mint: env.mint,
  });
  const mintTo = getMintToInstruction({
    mint: env.mint,
    token: ata,
    mintAuthority: env.payer,
    amount,
  });
  await send(env.svm, env.payer, [createAta, mintTo]);
  return ata;
}

/** Register a name (defaults: owner = payer, 1 year). Returns the name-record PDA. */
export async function registerName(
  env: TestEnv,
  name: string,
  opts?: { owner?: Address; years?: number; payer?: KeyPairSigner; payerAta?: Address; referral?: Address },
): Promise<Address> {
  const payer = opts?.payer ?? env.payer;
  const { name: label, tld, hash } = nameParts(name);
  const ix = await getRegisterNameInstructionAsync({
    payer,
    owner: opts?.owner ?? payer.address,
    payerTokenAccount: opts?.payerAta ?? env.payerAta,
    treasuryTokenAccount: env.treasury,
    stakingVault: env.stakingVault,
    burnVault: env.burnVault,
    referralTokenAccount: opts?.referral,
    paymentMint: env.mint,
    name: label,
    tld,
    nameHash: hash,
    years: opts?.years ?? 1,
  });
  await send(env.svm, payer, [ix]);
  const [pda] = await findNameRecordPda({ nameHash: hash });
  return pda;
}

/** Create a subdomain `<label>.<parentInput>` (signer/owner default to env.payer). */
export async function wrapSubdomain(
  env: TestEnv,
  parentInput: string,
  label: string,
  opts?: { owner?: Address; signer?: KeyPairSigner },
): Promise<Address> {
  const p = nameInfo(parentInput);
  const childHash = computeSubdomainHash(p.hash, label);
  const [parentName] = await findNameRecordPda({ nameHash: p.hash });
  const signer = opts?.signer ?? env.payer;
  const ix = await getWrapSubdomainInstructionAsync({
    owner: signer,
    subdomainOwner: opts?.owner ?? signer.address,
    parentName,
    label,
    nameHash: childHash,
  });
  await send(env.svm, signer, [ix]);
  const [pda] = await findNameRecordPda({ nameHash: childHash });
  return pda;
}

/** Native-SOL balance (lamports) of an address. */
export function solBalance(svm: LiteSVM, addr: Address): bigint {
  return svm.getBalance(addr) ?? 0n;
}

/** List `name` for sale; returns the listing PDA. */
export async function listName(
  env: TestEnv,
  name: string,
  priceLamports: bigint,
  opts?: { durationSeconds?: bigint; signer?: KeyPairSigner },
): Promise<Address> {
  const signer = opts?.signer ?? env.payer;
  const [nameRecord] = await findNameRecordPda({ nameHash: nameInfo(name).hash });
  const [listing] = await findListing(name);
  await send(env.svm, signer, [
    getListNameInstruction({
      owner: signer,
      nameRecord,
      listing,
      price: priceLamports,
      durationSeconds: opts?.durationSeconds ?? BigInt(30 * 86_400),
    }),
  ]);
  return listing;
}

/** Buy `name` as `buyer`, paying `expectedPrice` lamports to `seller`. */
export async function buyName(
  env: TestEnv,
  name: string,
  buyer: KeyPairSigner,
  expectedPrice: bigint,
  seller: Address,
): Promise<void> {
  const [nameRecord] = await findNameRecordPda({ nameHash: nameInfo(name).hash });
  const [listing] = await findListing(name);
  const [config] = await findConfigPda();
  await send(env.svm, buyer, [
    getBuyNameInstruction({ buyer, seller, solTreasury: env.solTreasury, config, nameRecord, listing, expectedPrice }),
  ]);
}

/** Make a SOL offer on `name` as `buyer` (escrows `amount` lamports). Returns the offer PDA. */
export async function makeOffer(
  env: TestEnv,
  name: string,
  buyer: KeyPairSigner,
  amount: bigint,
  opts?: { durationSeconds?: bigint },
): Promise<Address> {
  const [nameRecord] = await findNameRecordPda({ nameHash: nameInfo(name).hash });
  const [offer] = await findOffer(name, buyer.address);
  await send(env.svm, buyer, [
    getMakeOfferInstruction({
      buyer,
      nameRecord,
      offer,
      amount,
      durationSeconds: opts?.durationSeconds ?? BigInt(30 * 86_400),
    }),
  ]);
  return offer;
}

/** Accept `buyerAddr`'s offer on `name` as the owner (default env.payer). */
export async function acceptOffer(
  env: TestEnv,
  name: string,
  buyerAddr: Address,
  owner?: KeyPairSigner,
): Promise<void> {
  const signer = owner ?? env.payer;
  const [nameRecord] = await findNameRecordPda({ nameHash: nameInfo(name).hash });
  const [offer] = await findOffer(name, buyerAddr);
  const [config] = await findConfigPda();
  await send(env.svm, signer, [
    getAcceptOfferInstruction({ owner: signer, buyer: buyerAddr, solTreasury: env.solTreasury, config, nameRecord, offer }),
  ]);
}

/** Create a fresh SPL mint (payer = mint authority); returns its address. */
export async function createMint(env: TestEnv, decimals = 6): Promise<Address> {
  const m = await generateKeyPairSigner();
  await send(env.svm, env.payer, [
    getCreateAccountInstruction({
      payer: env.payer,
      newAccount: m,
      lamports: lamports(10_000_000n),
      space: 82n,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMint2Instruction({ mint: m.address, decimals, mintAuthority: env.payer.address, freezeAuthority: null }),
  ]);
  return m.address;
}

/** Create `owner`'s ATA for `mint` and mint `amount` to it; returns the ATA. */
export async function mintTokens(env: TestEnv, mint: Address, owner: Address, amount: bigint): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  await send(env.svm, env.payer, [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: env.payer, owner, mint }),
    getMintToInstruction({ mint, token: ata, mintAuthority: env.payer, amount }),
  ]);
  return ata;
}

export type StakingCtx = { solansMint: Address; stakePool: Address; stakeVault: Address; rewardVault: Address };

/** Create the `$SOLANS` mint + staking pool (which repoints Config.staking_vault). */
export async function initStaking(env: TestEnv): Promise<StakingCtx> {
  const solansMint = await createMint(env, 6);
  await send(env.svm, env.payer, [
    await getInitStakePoolInstructionAsync({ admin: env.payer, solansMint, paymentMint: env.mint }),
  ]);
  const [stakePool] = await findStakePoolPda();
  const [stakeVault] = await findAssociatedTokenPda({ owner: stakePool, mint: solansMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [rewardVault] = await findAssociatedTokenPda({ owner: stakePool, mint: env.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  // init_stake_pool repoints Config.staking_vault at the pool reward vault on-chain,
  // so subsequent registerName fee routing must target it too.
  env.stakingVault = rewardVault;
  return { solansMint, stakePool, stakeVault, rewardVault };
}

/** Boot a LiteSVM, load the program, create a 6-decimal mint + funded payer ATA + treasury, init config. */
export async function setupEnv(opts?: { gracePeriodSeconds?: bigint }): Promise<TestEnv> {
  const svm = new LiteSVM();
  svm.addProgramFromFile(SOLANS_PROGRAM_ADDRESS, PROGRAM_SO);
  // Metaplex Token Metadata, needed by tokenize_name / redeem_name CPIs.
  svm.addProgramFromFile(MPL_PROGRAM_ADDRESS, MPL_SO);

  const payer = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(1_000_000_000_000n));

  // Create the payment mint (6 decimals, payer is the mint authority).
  const mintSigner = await generateKeyPairSigner();
  await send(svm, payer, [
    getCreateAccountInstruction({
      payer,
      newAccount: mintSigner,
      lamports: lamports(10_000_000n),
      space: 82n,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMint2Instruction({
      mint: mintSigner.address,
      decimals: 6,
      mintAuthority: payer.address,
      freezeAuthority: null,
    }),
  ]);
  const mint = mintSigner.address;

  const solTreasury = await generateKeyPairSigner();
  const env: TestEnv = {
    svm,
    payer,
    mint,
    payerAta: mint,
    treasury: mint,
    treasuryOwner: mint,
    solTreasury: solTreasury.address,
    stakingVault: mint,
    burnVault: mint,
  };

  // Payer ATA with a large balance.
  env.payerAta = await mintTokensTo(env, payer.address, 1_000_000_000_000n);

  // Treasury = an ATA owned by a separate authority.
  const treasuryOwner = await generateKeyPairSigner();
  const [treasury] = await findAssociatedTokenPda({
    owner: treasuryOwner.address,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  await send(svm, payer, [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: treasuryOwner.address, mint }),
  ]);
  env.treasury = treasury;
  env.treasuryOwner = treasuryOwner.address;

  // Fee-split vaults (§8.2): ATAs of fresh owners for the staking + burn shares.
  for (const which of ["staking", "burn"] as const) {
    const owner = await generateKeyPairSigner();
    const [vault] = await findAssociatedTokenPda({ owner: owner.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    await send(svm, payer, [
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: owner.address, mint }),
    ]);
    if (which === "staking") env.stakingVault = vault;
    else env.burnVault = vault;
  }

  // Initialize the registry config.
  await send(svm, payer, [
    await getInitConfigInstructionAsync({
      admin: payer,
      paymentMint: mint,
      treasuryTokenAccount: treasury,
      stakingVault: env.stakingVault,
      burnVault: env.burnVault,
      price1: 1_000_000_000n,
      price2: 200_000_000n,
      price3: 50_000_000n,
      price4: 10_000_000n,
      price5plus: 1_000_000n,
      priceNumeric: PRICE_NUMERIC,
      gracePeriodSeconds: opts?.gracePeriodSeconds ?? 7_776_000n,
      minYears: 1,
      maxYears: 10,
      solTreasury: env.solTreasury,
      marketplaceFeeBps: MARKETPLACE_FEE_BPS,
      stakingFeeBps: STAKING_FEE_BPS,
      referralFeeBps: REFERRAL_FEE_BPS,
      burnFeeBps: BURN_FEE_BPS,
    }),
  ]);

  return env;
}
