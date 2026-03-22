import { createHash } from "node:crypto";
import { findNameRecordPda } from "./generated";
import { DEFAULT_TLD, parseName, type Tld } from "./normalize";

/**
 * Canonical name hash: `sha256(name + "." + tld)`.
 *
 * MUST match `compute_name_hash` in `programs/solans/src/utils.rs` byte-for-byte
 * (sha256 over the same UTF-8 bytes); the PDA-parity test guards this. `name`
 * must already be a normalized label and `tld` an allowed TLD — use
 * {@link nameParts} / {@link nameHashFor} for raw input.
 */
export function computeNameHash(name: string, tld: string = DEFAULT_TLD): Uint8Array {
  const data = new TextEncoder().encode(`${name}.${tld}`);
  return new Uint8Array(createHash("sha256").update(data).digest());
}

/** Parse raw input (`name` or `name.tld`) into its label, tld, and 32-byte hash. */
export function nameParts(input: string, tldOverride?: string): { name: string; tld: Tld; hash: Uint8Array } {
  const { name, tld } = parseName(input, tldOverride);
  return { name, tld, hash: computeNameHash(name, tld) };
}

/** Normalize raw input and return its 32-byte canonical hash. */
export function nameHashFor(input: string, tldOverride?: string): Uint8Array {
  return nameParts(input, tldOverride).hash;
}

/** Derive the name-record PDA for a raw name (matches the on-chain seeds). */
export async function findNameRecord(input: string, tldOverride?: string) {
  return findNameRecordPda({ nameHash: nameHashFor(input, tldOverride) });
}
