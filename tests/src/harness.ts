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
  decodeConfig,
  decodeNameRecord,
  decodeReverseRecord,
  findNameRecordPda,
  getInitConfigInstructionAsync,
  getRegisterNameInstructionAsync,
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
};

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
  opts?: { owner?: Address; years?: number; payer?: KeyPairSigner; payerAta?: Address },
): Promise<Address> {
  const payer = opts?.payer ?? env.payer;
  const { name: label, tld, hash } = nameParts(name);
  const ix = await getRegisterNameInstructionAsync({
    payer,
    owner: opts?.owner ?? payer.address,
    payerTokenAccount: opts?.payerAta ?? env.payerAta,
    treasuryTokenAccount: env.treasury,
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

  const env: TestEnv = { svm, payer, mint, payerAta: mint, treasury: mint, treasuryOwner: mint };

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

  // Initialize the registry config.
  await send(svm, payer, [
    await getInitConfigInstructionAsync({
      admin: payer,
      paymentMint: mint,
      treasuryTokenAccount: treasury,
      price1: 1_000_000_000n,
      price2: 200_000_000n,
      price3: 50_000_000n,
      price4: 10_000_000n,
      price5plus: 1_000_000n,
      gracePeriodSeconds: opts?.gracePeriodSeconds ?? 7_776_000n,
      minYears: 1,
      maxYears: 10,
    }),
  ]);

  return env;
}
