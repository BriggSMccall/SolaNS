use anchor_lang::prelude::*;

/// A fixed-price marketplace listing (PDA, seeds = [b"listing", name_hash]).
///
/// Non-custodial: the name's `owner` stays with the seller (a `listed` flag on
/// the `NameRecord` freezes it); this account just records the sale terms. Price
/// is in **lamports** (native SOL). `buy_name` pays the seller + a protocol fee
/// atomically and flips ownership.
#[account]
#[derive(InitSpace)]
pub struct Listing {
    /// The seller — must still equal `NameRecord.owner` at buy time.
    pub seller: Pubkey,
    /// The listed name's hash (matches `NameRecord.name_hash`).
    pub name_hash: [u8; 32],
    /// Sale price in lamports.
    pub price: u64,
    /// Unix timestamp after which the listing can no longer be bought.
    pub expires_at: i64,
    /// Canonical PDA bump.
    pub bump: u8,
}
