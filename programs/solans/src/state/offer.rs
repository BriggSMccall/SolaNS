use anchor_lang::prelude::*;

/// A standing SOL bid on a name (PDA, seeds = [b"offer", name_hash, buyer]).
///
/// The bid escrows real lamports inside this account (its balance = rent +
/// `amount`). `accept_offer` pays the owner from the escrow and flips ownership;
/// `cancel_offer` refunds the bidder. One offer per (name, buyer), so different
/// buyers can bid concurrently and the owner picks which to accept.
#[account]
#[derive(InitSpace)]
pub struct Offer {
    /// The bidder — receives the name on accept, or a refund on cancel.
    pub buyer: Pubkey,
    /// The target name's hash (matches `NameRecord.name_hash`).
    pub name_hash: [u8; 32],
    /// Escrowed bid amount in lamports.
    pub amount: u64,
    /// Unix timestamp after which the offer can no longer be accepted.
    pub expires_at: i64,
    /// Canonical PDA bump.
    pub bump: u8,
}
