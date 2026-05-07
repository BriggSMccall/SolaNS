//! Canonical SOLANS name hashing — byte-identical to `programs/solans/src/utils.rs`
//! (`compute_name_hash` / `compute_subdomain_hash`) and `clients/ts/src/hashName.ts`.
//! keccak256 (ENS namehash convention), **not** NIST sha3-256.
use solana_keccak_hasher::hashv;

/// `keccak256(name + "." + tld)` — the canonical key for a top-level name, and the
/// `NameRecord` PDA seed.
pub fn name_hash(name: &str, tld: &str) -> [u8; 32] {
    hashv(&[name.as_bytes(), b".", tld.as_bytes()]).to_bytes()
}

/// A subdomain's hash: `keccak256(0x00 || parent_hash || label)`. The `0x00`
/// separator domain-separates subdomains from top-level names.
pub fn subdomain_hash(parent_hash: &[u8; 32], label: &str) -> [u8; 32] {
    hashv(&[&[0u8], parent_hash.as_ref(), label.as_bytes()]).to_bytes()
}

/// Hash a (possibly dotted) name path: `"alex.sol"`, or `"pay.alex.sol"`,
/// `"a.b.alex.sol"`. The **last** segment is the TLD and the second-to-last is the
/// root label; the hash is folded **root-first** (mirrors the TS `nameInfo`): start
/// from `name_hash(root, tld)`, then apply each subdomain label from the one nearest
/// the root outward. Panics-free; an input without a `.` is treated as `name.sol`
/// is *not* assumed here — callers pass a full `name.tld` path.
pub fn name_hash_for_path(path: &str) -> [u8; 32] {
    let seg: Vec<&str> = path.split('.').collect();
    let n = seg.len();
    if n < 2 {
        // No TLD in the path — fall back to hashing it as a bare label under the
        // default `.sol` TLD, matching the TS default.
        return name_hash(path, "sol");
    }
    let mut h = name_hash(seg[n - 2], seg[n - 1]);
    // Subdomain labels are seg[0..n-2]; apply nearest-the-root (index n-3) down to 0.
    for i in (0..n - 2).rev() {
        h = subdomain_hash(&h, seg[i]);
    }
    h
}
