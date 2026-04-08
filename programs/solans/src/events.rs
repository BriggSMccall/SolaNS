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
