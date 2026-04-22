use anchor_lang::prelude::*;

/// An English auction for a name (PDA, seeds = [b"auction", name_hash]).
///
/// Bids are denominated in `$SOLANS` and escrowed in a PDA-owned `bid_vault` ATA.
/// Only the **current highest bid** is held — a higher `bid` refunds the previous
/// bidder and re-escrows. The name's `owner` stays with the seller (a `listed`
/// flag on the `NameRecord` freezes it) until `settle_auction` transfers it to the
/// winner. `cancel_auction` (seller, zero bids) or settlement closes this account.
#[account]
#[derive(InitSpace)]
pub struct Auction {
    /// The seller — receives the winning bid (minus fee) + the rent at settle.
    pub seller: Pubkey,
    /// The auctioned name's hash (matches `NameRecord.name_hash`).
    pub name_hash: [u8; 32],
    /// The PDA-owned `$SOLANS` ATA holding the current highest bid.
    pub bid_vault: Pubkey,
    /// Current highest bidder, or `None` until the first bid.
    pub highest_bidder: Option<Pubkey>,
    /// Current highest bid (`$SOLANS` base units); `0` until the first bid.
    pub highest_bid: u64,
    /// Minimum acceptable first bid (`$SOLANS` base units).
    pub reserve_price: u64,
    /// Minimum raise over the current highest bid.
    pub min_increment: u64,
    /// Unix timestamp the auction closes (extended by late bids).
    pub end_time: i64,
    /// Canonical PDA bump.
    pub bump: u8,
}
