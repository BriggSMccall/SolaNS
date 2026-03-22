import { fetchEncodedAccount, type Address, type MaybeEncodedAccount } from "@solana/kit";
import {
  decodeNameRecord,
  decodeReverseRecord,
  findNameRecord,
  findNameRecordPda,
  findReverseRecordPda,
  type NameRecord,
  type Record as SolansRecord,
} from "@solans/client";

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

  /** Resolve a name (`"alex.sol"`, `"alex.chain"`, or bare `"alex"`) to its record, or null. */
  async resolve(name: string): Promise<NameRecord | null> {
    const [pda] = await findNameRecord(name);
    const acct = await this.fetchAccount(pda);
    return acct.exists ? decodeNameRecord(acct).data : null;
  }

  /** All key→value records for a name (empty array if unregistered). */
  async getRecords(name: string): Promise<SolansRecord[]> {
    return (await this.resolve(name))?.records ?? [];
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
