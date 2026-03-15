import { createHash } from "node:crypto";
import { findNameRecordPda } from "./generated";
import { normalizeName, TLD } from "./normalize";

/**
 * Canonical name hash: `sha256(name + "." + tld)`.
 *
 * MUST match `compute_name_hash` in `programs/solans/src/utils.rs` byte-for-byte
 * (sha256 over the same UTF-8 bytes). The PDA-parity test guards this.
 * `name` must already be normalized (use {@link nameHashFor} for raw input).
 */
export function computeNameHash(name: string, tld: string = TLD): Uint8Array {
  const data = new TextEncoder().encode(`${name}.${tld}`);
  return new Uint8Array(createHash("sha256").update(data).digest());
}

/** Normalize raw input and return its 32-byte canonical hash. */
export function nameHashFor(input: string, tld: string = TLD): Uint8Array {
  return computeNameHash(normalizeName(input), tld);
}

/** Derive the name-record PDA for a raw name (matches the on-chain seeds). */
export async function findNameRecord(input: string, tld: string = TLD) {
  return findNameRecordPda({ nameHash: nameHashFor(input, tld) });
}
