//! Marketplace events (emitted for off-chain indexers — spec §13 Helius/Geyser).

use anchor_lang::prelude::*;

#[event]
pub struct NameListed {
    pub name_hash: [u8; 32],
    pub seller: Pubkey,
    pub price: u64,
    pub expires_at: i64,
}

#[event]
pub struct ListingCancelled {
    pub name_hash: [u8; 32],
    pub seller: Pubkey,
}

#[event]
pub struct NameSold {
    pub name_hash: [u8; 32],
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price: u64,
    pub fee: u64,
}

#[event]
pub struct OfferMade {
    pub name_hash: [u8; 32],
    pub buyer: Pubkey,
    pub amount: u64,
    pub expires_at: i64,
}

#[event]
pub struct OfferAccepted {
    pub name_hash: [u8; 32],
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub fee: u64,
}

#[event]
pub struct OfferCancelled {
    pub name_hash: [u8; 32],
    pub buyer: Pubkey,
}

/// A name registered by paying the fee in `$SOLANS` (§8.1), which is burned.
#[event]
pub struct RegisteredWithSolans {
    pub name_hash: [u8; 32],
    pub payer: Pubkey,
    pub solans_burned: u64,
}

/// A name renewed by paying the fee in `$SOLANS` (§8.1), which is burned.
#[event]
pub struct RenewedWithSolans {
    pub name_hash: [u8; 32],
    pub payer: Pubkey,
    pub solans_burned: u64,
}

/// A keeper burned `$SOLANS` and drained the burn vault in exchange (§8.1 buyback).
#[event]
pub struct BuybackBurn {
    pub keeper: Pubkey,
    pub solans_burned: u64,
    pub usdc_reimbursed: u64,
}

/// An English `$SOLANS` auction opened on a name (§9.1).
#[event]
pub struct AuctionStarted {
    pub name_hash: [u8; 32],
    pub seller: Pubkey,
    pub reserve_price: u64,
    pub end_time: i64,
}

/// A new highest bid (the previous bidder was refunded).
#[event]
pub struct BidPlaced {
    pub name_hash: [u8; 32],
    pub bidder: Pubkey,
    pub amount: u64,
    pub end_time: i64,
}

/// An auction settled: the name moved to the winner, the seller was paid, the fee burned.
#[event]
pub struct AuctionSettled {
    pub name_hash: [u8; 32],
    pub seller: Pubkey,
    pub winner: Option<Pubkey>,
    pub amount: u64,
    pub fee: u64,
}

/// An auction cancelled by the seller before any bid.
#[event]
pub struct AuctionCancelled {
    pub name_hash: [u8; 32],
    pub seller: Pubkey,
}
