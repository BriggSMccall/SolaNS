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
