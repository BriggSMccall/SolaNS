import { keccak_256 } from "@noble/hashes/sha3";
import { getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";
import { findNameRecordPda, SOLANS_PROGRAM_ADDRESS } from "./generated";
import { DEFAULT_TLD, parseName, parsePath, type Tld } from "./normalize";

const LISTING_SEED = new TextEncoder().encode("listing");
const OFFER_SEED = new TextEncoder().encode("offer");
const AUCTION_SEED = new TextEncoder().encode("auction");

/**
 * Canonical name hash: `keccak256(name + "." + tld)` (spec §2.1, ENS namehash).
 *
 * MUST match `compute_name_hash` in `programs/solans/src/utils.rs` byte-for-byte
 * (keccak256 over the same UTF-8 bytes); the PDA-parity test guards this. `name`
 * must already be a normalized label and `tld` an allowed TLD — use
 * {@link nameParts} / {@link nameHashFor} for raw input.
 */
export function computeNameHash(name: string, tld: string = DEFAULT_TLD): Uint8Array {
  return keccak_256(new TextEncoder().encode(`${name}.${tld}`));
}

/**
 * Canonical subdomain hash: `keccak256(0x00 || parentHash || label)`.
 *
 * MUST match `compute_subdomain_hash` in `programs/solans/src/utils.rs`. The
 * `0x00` separator keeps subdomain hashes disjoint from top-level names.
 */
export function computeSubdomainHash(parentHash: Uint8Array, label: string): Uint8Array {
  const labelBytes = new TextEncoder().encode(label);
  const buf = new Uint8Array(1 + parentHash.length + labelBytes.length);
  buf[0] = 0;
  buf.set(parentHash, 1);
  buf.set(labelBytes, 1 + parentHash.length);
  return keccak_256(buf);
}

export interface NameInfo {
  /** Leaf-first labels, e.g. `["pay", "alex"]` for `pay.alex.sol`. */
  labels: string[];
  tld: Tld;
  /** The (leaf) name's 32-byte hash = its PDA seed. */
  hash: Uint8Array;
  /** The immediate parent's hash, or null for a top-level name. */
  parentHash: Uint8Array | null;
  /** Subdomain depth: 0 for top-level, +1 per level. */
  depth: number;
}

/**
 * Resolve raw input (`"pay.alex.sol"` / `"alex.sol"` / `"alex"`) to its labels,
 * tld, and the recursive hash. Folds **root-first** to mirror the on-chain
 * recursion: the root label is hashed flat, then each descendant folds the
 * running hash with its label via {@link computeSubdomainHash}.
 */
export function nameInfo(input: string, tldOverride?: string): NameInfo {
  const { labels, tld } = parsePath(input, tldOverride);
  let hash = computeNameHash(labels[labels.length - 1], tld); // root (flat)
  let parentHash: Uint8Array | null = null;
  for (let i = labels.length - 2; i >= 0; i--) {
    parentHash = hash;
    hash = computeSubdomainHash(hash, labels[i]);
  }
  return { labels, tld, hash, parentHash, depth: labels.length - 1 };
}

/** Parse raw single-label input (`name` or `name.tld`) into label, tld, hash. */
export function nameParts(input: string, tldOverride?: string): { name: string; tld: Tld; hash: Uint8Array } {
  const { name, tld } = parseName(input, tldOverride);
  return { name, tld, hash: computeNameHash(name, tld) };
}

/** Normalize raw input (single label OR subdomain path) to its 32-byte hash. */
export function nameHashFor(input: string, tldOverride?: string): Uint8Array {
  return nameInfo(input, tldOverride).hash;
}

/** Derive the name-record PDA for a raw name/path (matches the on-chain seeds). */
export async function findNameRecord(input: string, tldOverride?: string) {
  return findNameRecordPda({ nameHash: nameHashFor(input, tldOverride) });
}

/** Derive the marketplace listing PDA for a raw name/path (`[b"listing", name_hash]`). */
export async function findListing(input: string, tldOverride?: string) {
  return getProgramDerivedAddress({
    programAddress: SOLANS_PROGRAM_ADDRESS,
    seeds: [LISTING_SEED, nameHashFor(input, tldOverride)],
  });
}

/** Derive an offer PDA for a raw name/path + bidder (`[b"offer", name_hash, buyer]`). */
export async function findOffer(input: string, buyer: Address, tldOverride?: string) {
  return getProgramDerivedAddress({
    programAddress: SOLANS_PROGRAM_ADDRESS,
    seeds: [OFFER_SEED, nameHashFor(input, tldOverride), getAddressEncoder().encode(buyer)],
  });
}

/** Derive the auction PDA for a raw name/path (`[b"auction", name_hash]`). */
export async function findAuction(input: string, tldOverride?: string) {
  return getProgramDerivedAddress({
    programAddress: SOLANS_PROGRAM_ADDRESS,
    seeds: [AUCTION_SEED, nameHashFor(input, tldOverride)],
  });
}
