use crate::constants::*;
use anchor_lang::prelude::*;

/// Reverse lookup record (PDA, seeds = [b"reverse", owner]).
///
/// Maps a wallet to its canonical name. Stores the human-readable `name`/`tld`
/// (the forward record only keeps the hash) so `resolve(pubkey) -> name` works.
/// Best-effort: after a transfer/claim the forward record's `owner` may diverge,
/// so resolvers must round-trip validate (`reverse.owner == name_record.owner`).
#[account]
#[derive(InitSpace)]
pub struct ReverseRecord {
    /// The wallet this reverse record belongs to.
    pub owner: Pubkey,
    /// keccak256 hash of the name it points to (matches `NameRecord.name_hash`).
    pub name_hash: [u8; 32],
    /// Human-readable name label (e.g. "alex").
    #[max_len(NAME_MAX_LEN)]
    pub name: String,
    /// Top-level domain (e.g. "sol").
    #[max_len(TLD_MAX_LEN)]
    pub tld: String,
    /// Canonical PDA bump.
    pub bump: u8,
}
