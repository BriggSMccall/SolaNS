/**
 * Index storage (§13). `IndexStore` is the async interface a persistent backend
 * (Postgres, SQLite, …) would implement; `MemoryStore` is the in-process reference
 * used in tests and small deployments. Entries are keyed by the **`name_record`
 * PDA** (the stable identity — transfers/burns/renews reference it, and a subdomain
 * links to its parent by PDA), with the plaintext `fullName` recovered from
 * instruction data.
 */
import type { Address } from "@solana/kit";
import type { IndexEvent } from "./parse.ts";

const YEAR = 31_536_000;

/** One indexed name (top-level or subdomain). */
export interface NameEntry {
  /** The `name_record` PDA — the entry's stable key. */
  nameRecord: Address;
  /** Dotted human name, e.g. `"alex.sol"` / `"pay.alex.sol"` (absent for an orphan
   *  subdomain whose parent hasn't been indexed yet). */
  fullName?: string;
  /** Leaf label, e.g. `"alex"` / `"pay"`. */
  name: string;
  tld?: string;
  owner?: Address;
  nameHash?: string;
  /** Parent `name_record` PDA for a subdomain. */
  parent?: Address;
  registeredAt?: number;
  expiresAt?: number;
  /** False once burned. */
  active: boolean;
  lastSig?: string;
  lastSlot?: number;
}

/** Per-transaction metadata threaded into {@link applyEvent}. */
export interface EventMeta {
  sig?: string;
  slot?: number;
  /** Block unix time (seconds), used to derive `registeredAt`/`expiresAt`. */
  ts?: number;
}

export interface IndexStore {
  upsert(entry: NameEntry): Promise<void>;
  getByRecord(nameRecord: Address): Promise<NameEntry | undefined>;
  getByName(fullName: string): Promise<NameEntry | undefined>;
  byOwner(owner: Address): Promise<NameEntry[]>;
  search(prefix: string, limit?: number): Promise<NameEntry[]>;
  /** Active names with a known label — the keeper's auto-renew watchlist. */
  watchlist(): Promise<string[]>;
  all(): Promise<NameEntry[]>;
}

/** In-memory `IndexStore` keyed by the `name_record` PDA. */
export class MemoryStore implements IndexStore {
  private byRecord = new Map<Address, NameEntry>();

  async upsert(entry: NameEntry): Promise<void> {
    this.byRecord.set(entry.nameRecord, entry);
  }
  async getByRecord(nameRecord: Address): Promise<NameEntry | undefined> {
    return this.byRecord.get(nameRecord);
  }
  async getByName(fullName: string): Promise<NameEntry | undefined> {
    for (const e of this.byRecord.values()) if (e.fullName === fullName) return e;
    return undefined;
  }
  async byOwner(owner: Address): Promise<NameEntry[]> {
    return [...this.byRecord.values()].filter((e) => e.owner === owner && e.active);
  }
  async search(prefix: string, limit = 50): Promise<NameEntry[]> {
    const p = prefix.toLowerCase();
    return [...this.byRecord.values()]
      .filter((e) => e.active && (e.fullName?.toLowerCase().startsWith(p) || e.name.toLowerCase().startsWith(p)))
      .slice(0, limit);
  }
  async watchlist(): Promise<string[]> {
    return [...this.byRecord.values()].filter((e) => e.active && e.fullName).map((e) => e.fullName!);
  }
  async all(): Promise<NameEntry[]> {
    return [...this.byRecord.values()];
  }
}

/** Fold one decoded {@link IndexEvent} into the store (idempotent-ish upserts). */
export async function applyEvent(store: IndexStore, ev: IndexEvent, meta: EventMeta = {}): Promise<void> {
  switch (ev.kind) {
    case "register": {
      await store.upsert({
        nameRecord: ev.nameRecord,
        fullName: ev.fullName,
        name: ev.name,
        tld: ev.tld,
        owner: ev.owner,
        nameHash: ev.nameHash,
        registeredAt: meta.ts,
        expiresAt: meta.ts != null ? meta.ts + ev.years * YEAR : undefined,
        active: true,
        lastSig: meta.sig,
        lastSlot: meta.slot,
      });
      return;
    }
    case "renew": {
      const e = await store.getByRecord(ev.nameRecord);
      const base = e?.expiresAt ?? meta.ts ?? 0;
      await store.upsert({
        ...(e ?? { nameRecord: ev.nameRecord, name: ev.name, tld: ev.tld, fullName: `${ev.name}.${ev.tld}`, active: true }),
        expiresAt: base + ev.years * YEAR,
        lastSig: meta.sig,
        lastSlot: meta.slot,
      });
      return;
    }
    case "subdomain": {
      const parent = await store.getByRecord(ev.parent);
      const fullName = parent?.fullName ? `${ev.label}.${parent.fullName}` : undefined;
      await store.upsert({
        nameRecord: ev.nameRecord,
        fullName,
        name: ev.label,
        tld: parent?.tld,
        owner: ev.owner,
        nameHash: ev.nameHash,
        parent: ev.parent,
        registeredAt: meta.ts,
        active: true,
        lastSig: meta.sig,
        lastSlot: meta.slot,
      });
      return;
    }
    case "transfer": {
      const e = await store.getByRecord(ev.nameRecord);
      if (e) await store.upsert({ ...e, owner: ev.newOwner, lastSig: meta.sig, lastSlot: meta.slot });
      return;
    }
    case "burn": {
      const e = await store.getByRecord(ev.nameRecord);
      if (e) await store.upsert({ ...e, active: false, lastSig: meta.sig, lastSlot: meta.slot });
      return;
    }
  }
}
