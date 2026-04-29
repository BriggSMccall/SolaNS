//! Program-wide constants: PDA seed prefixes, name/record caps, and time math.

// PDA seed prefixes (the client mirrors these exactly when deriving addresses).
pub const CONFIG_SEED: &[u8] = b"config";
pub const NAME_SEED: &[u8] = b"name";
pub const REVERSE_SEED: &[u8] = b"reverse";
pub const LISTING_SEED: &[u8] = b"listing";
pub const OFFER_SEED: &[u8] = b"offer";
pub const STAKE_POOL_SEED: &[u8] = b"stake_pool";
pub const STAKE_SEED: &[u8] = b"stake";
pub const AUCTION_SEED: &[u8] = b"auction";

// Anti-snipe window: a bid within this many seconds of `end_time` extends the
// auction to `now + AUCTION_EXTENSION_SECONDS` (§9.1 "5-min auto-extend").
pub const AUCTION_EXTENSION_SECONDS: i64 = 300;

// Marketplace fee math: basis-point denominator + a hard cap on the fee.
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_FEE_BPS: u16 = 1_000; // 10% ceiling, validated in config

// Staking reward-per-share fixed-point scale (1e12), to keep per-share precision.
pub const ACC_SCALE: u128 = 1_000_000_000_000;

// §8.1 pay-in-`$SOLANS` rate scale: `Config.solans_rate` is `$SOLANS` base units
// per 1 payment-mint base unit, scaled by this (e.g. 1:1 => rate = 1_000_000).
pub const SOLANS_RATE_SCALE: u64 = 1_000_000;

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

// Auto-renew (§6.2): a name may only be auto-renewed once within this window of
// its expiry (30 days), so a keeper can't drain the owner's delegation early.
pub const RENEWAL_WINDOW_SECONDS: i64 = 2_592_000;

// Metaplex Token Metadata `name` field cap (the on-chain program enforces 32).
pub const MPL_NAME_MAX_LEN: usize = 32;

// Deepest subdomain level allowed (top-level = 0; e.g. 4 => a.b.c.d.root.tld).
pub const MAX_SUBDOMAIN_DEPTH: u8 = 4;

// TLDs the program accepts (the client mirrors this list). Each TLD is part of
// the name hash, so the same label under different TLDs gets a distinct PDA.
pub const ALLOWED_TLDS: &[&str] = &["sol", "chain", "web3"];
