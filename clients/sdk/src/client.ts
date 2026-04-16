import { fetchEncodedAccount, unwrapOption, type Address, type MaybeEncodedAccount } from "@solana/kit";
import {
  decodeConfig,
  decodeListing,
  decodeNameRecord,
  decodeOffer,
  decodeReverseRecord,
  decodeStakeAccount,
  decodeStakePool,
  findConfigPda,
  findListing,
  findNameRecord,
  findNameRecordPda,
  findOffer,
  findReverseRecordPda,
  findStakeAccountPda,
  findStakePoolPda,
  type Config,
  type Listing,
  type NameRecord,
  type Offer,
  type Record as SolansRecord,
  type StakeAccount,
  type StakePool,
} from "@solans/client";

const SOLANS_RATE_SCALE = 1_000_000n;
const BPS_DENOMINATOR = 10_000n;

/** Loads a raw account by address. Lets the SDK run against an RPC or litesvm. */
export type AccountFetcher = (address: Address) => Promise<MaybeEncodedAccount<Address>>;

/**
 * High-level read API for SOLANS names (Technical Concept §5/§10):
 * `resolve` / `reverseLookup` / `getRecords` / `getAddress`. Decoupled from the
 * transport via an {@link AccountFetcher} so it works against a kit RPC or an
 * in-process litesvm.
 */
export class SolansClient {
  constructor(private readonly fetchAccount: AccountFetcher) {}

  /** Build a client backed by a kit RPC. */
  static fromRpc(rpc: Parameters<typeof fetchEncodedAccount>[0]): SolansClient {
    return new SolansClient((address) => fetchEncodedAccount(rpc, address));
  }

  /** Build a client from a custom account fetcher (e.g. `svm.getAccount`). */
  static fromFetcher(fetchAccount: AccountFetcher): SolansClient {
    return new SolansClient(fetchAccount);
  }

  /**
   * Resolve a name or subdomain path (`"alex.sol"`, `"alex.chain"`, bare
   * `"alex"`, or `"pay.alex.sol"`) to its record, or null.
   *
   * For a subdomain, the **parent chain is validated**: every ancestor PDA must
   * still exist and its `registeredAt` must match what the child captured. A
   * burned parent (PDA gone) or a claimed/re-registered parent (new
   * `registeredAt`) invalidates the whole subtree → null.
   */
  async resolve(name: string): Promise<NameRecord | null> {
    const [pda] = await findNameRecord(name);
    const acct = await this.fetchAccount(pda);
    if (!acct.exists) return null;
    const leaf = decodeNameRecord(acct).data;

    let cursor: NameRecord = leaf;
    for (let parent = unwrapOption(cursor.parent); parent !== null; parent = unwrapOption(cursor.parent)) {
      const pacct = await this.fetchAccount(parent);
      if (!pacct.exists) return null; // parent burned -> subtree dead
      const prec = decodeNameRecord(pacct).data;
      if (prec.registeredAt !== cursor.parentRegisteredAt) return null; // re-registered/claimed
      cursor = prec;
    }
    return leaf;
  }

  /** All key→value records for a name (empty array if unregistered). */
  async getRecords(name: string): Promise<SolansRecord[]> {
    return (await this.resolve(name))?.records ?? [];
  }

  /** The active marketplace listing for a name, or null if not listed. */
  async getListing(name: string): Promise<Listing | null> {
    const [pda] = await findListing(name);
    const acct = await this.fetchAccount(pda);
    return acct.exists ? decodeListing(acct).data : null;
  }

  /** A specific bidder's standing offer on a name, or null. */
  async getOffer(name: string, buyer: Address): Promise<Offer | null> {
    const [pda] = await findOffer(name, buyer);
    const acct = await this.fetchAccount(pda);
    return acct.exists ? decodeOffer(acct).data : null;
  }

  /** The registry config singleton, or null if not initialized. */
  async getConfig(): Promise<Config | null> {
    const [pda] = await findConfigPda();
    const acct = await this.fetchAccount(pda);
    return acct.exists ? decodeConfig(acct).data : null;
  }

  /**
   * `$SOLANS` owed to pay a `usdcFee` registration/renewal fee in `$SOLANS` after
   * the §8.1 pay-in discount — mirrors `Config::solans_fee` on-chain. Throws if
   * pay-in is not configured.
   */
  async quoteSolansFee(usdcFee: bigint): Promise<bigint> {
    const cfg = await this.getConfig();
    if (!cfg || cfg.solansRate === 0n) throw new Error("pay-in-$SOLANS is not configured");
    const gross = (usdcFee * cfg.solansRate) / SOLANS_RATE_SCALE;
    return (gross * (BPS_DENOMINATOR - BigInt(cfg.solansDiscountBps))) / BPS_DENOMINATOR;
  }

  /**
   * Payment-mint reimbursement for a keeper burning `solansAmount` `$SOLANS` —
   * mirrors `Config::buyback_usdc` (the inverse, undiscounted rate).
   */
  async quoteBuyback(solansAmount: bigint): Promise<bigint> {
    const cfg = await this.getConfig();
    if (!cfg || cfg.solansRate === 0n) throw new Error("pay-in-$SOLANS is not configured");
    return (solansAmount * SOLANS_RATE_SCALE) / cfg.solansRate;
  }

  /** The global `$SOLANS` staking pool, or null if not initialized. */
  async getStakePool(): Promise<StakePool | null> {
    const [pda] = await findStakePoolPda();
    const acct = await this.fetchAccount(pda);
    return acct.exists ? decodeStakePool(acct).data : null;
  }

  /** A staker's position, or null. */
  async getStake(staker: Address): Promise<StakeAccount | null> {
    const [pda] = await findStakeAccountPda({ staker });
    const acct = await this.fetchAccount(pda);
    return acct.exists ? decodeStakeAccount(acct).data : null;
  }

  /** Pending (claimable) reward for a staker, accounting for vault deposits since the last sync. */
  async pendingReward(staker: Address): Promise<bigint> {
    const [pool, stake] = await Promise.all([this.getStakePool(), this.getStake(staker)]);
    if (!pool || !stake || stake.amount === 0n) return 0n;
    let accPerShare = pool.accRewardPerShare;
    if (pool.totalStaked > 0n) {
      const rv = await this.fetchAccount(pool.rewardVault);
      if (rv.exists) {
        // Token account `amount` is a u64 at offset 64.
        const bal = rv.data.subarray(64, 72).reduce((a, b, i) => a + (BigInt(b) << BigInt(8 * i)), 0n);
        const delta = bal > pool.lastRewardBalance ? bal - pool.lastRewardBalance : 0n;
        accPerShare += (delta * 1_000_000_000_000n) / pool.totalStaked;
      }
    }
    const accrued = (stake.amount * accPerShare) / 1_000_000_000_000n;
    return accrued > stake.rewardDebt ? accrued - stake.rewardDebt : 0n;
  }

  /** A single record value by key, or null. */
  async getRecord(name: string, key: string): Promise<string | null> {
    return (await this.getRecords(name)).find((r) => r.key === key)?.value ?? null;
  }

  /** A chain address record, e.g. `getAddress(name, "SOL")` reads `address.SOL`. */
  async getAddress(name: string, chain = "SOL"): Promise<string | null> {
    return this.getRecord(name, `address.${chain}`);
  }

  /**
   * Reverse lookup: a wallet → its primary name, round-trip validated
   * (`reverse.owner === name.owner`). Returns null if unset or stale.
   */
  async reverseLookup(owner: Address): Promise<string | null> {
    const [rpda] = await findReverseRecordPda({ owner });
    const rev = await this.fetchAccount(rpda);
    if (!rev.exists) return null;
    const r = decodeReverseRecord(rev).data;

    const [npda] = await findNameRecordPda({ nameHash: r.nameHash });
    const fwd = await this.fetchAccount(npda);
    if (!fwd.exists || decodeNameRecord(fwd).data.owner !== owner) return null; // stale
    return `${r.name}.${r.tld}`;
  }
}
