//! Program-wide constants: PDA seed prefixes, name/record caps, and time math.

// PDA seed prefixes (the client mirrors these exactly when deriving addresses).
pub const CONFIG_SEED: &[u8] = b"config";
pub const NAME_SEED: &[u8] = b"name";
pub const REVERSE_SEED: &[u8] = b"reverse";
pub const LISTING_SEED: &[u8] = b"listing";
pub const OFFER_SEED: &[u8] = b"offer";

// Marketplace fee math: basis-point denominator + a hard cap on the fee.
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_FEE_BPS: u16 = 1_000; // 10% ceiling, validated in config

// Name constraints (enforced on-chain over raw bytes).
pub const NAME_MIN_LEN: usize = 1;
pub const NAME_MAX_LEN: usize = 63; // DNS label cap
pub const TLD_MAX_LEN: usize = 8;

// Record key-value store caps (drive the fixed account allocation).
pub const MAX_RECORDS: usize = 16;
pub const KEY_MAX_LEN: usize = 32;
pub const VALUE_MAX_LEN: usize = 200;
pub const HOSTING_MAX_LEN: usize = 80;

// Time: 365-day approximation (leap seconds ignored for the MVP).
pub const SECONDS_PER_YEAR: i64 = 31_536_000;

// Metaplex Token Metadata `name` field cap (the on-chain program enforces 32).
pub const MPL_NAME_MAX_LEN: usize = 32;

// Deepest subdomain level allowed (top-level = 0; e.g. 4 => a.b.c.d.root.tld).
pub const MAX_SUBDOMAIN_DEPTH: u8 = 4;

// TLDs the program accepts (the client mirrors this list). Each TLD is part of
// the name hash, so the same label under different TLDs gets a distinct PDA.
pub const ALLOWED_TLDS: &[&str] = &["sol", "chain", "web3"];
