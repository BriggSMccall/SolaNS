//! PDA derivations — seeds from `programs/solans/src/constants.rs`. Each function
//! has a default-program-id form and a `_in` form taking an explicit program id
//! (used by a `SolansClient` built with `new_with_program_id`).
use crate::PROGRAM_ID;
use solana_program::pubkey::Pubkey;

pub const CONFIG_SEED: &[u8] = b"config";
pub const NAME_SEED: &[u8] = b"name";
pub const REVERSE_SEED: &[u8] = b"reverse";
pub const LISTING_SEED: &[u8] = b"listing";
pub const OFFER_SEED: &[u8] = b"offer";
pub const STAKE_POOL_SEED: &[u8] = b"stake_pool";
pub const STAKE_SEED: &[u8] = b"stake";
pub const AUCTION_SEED: &[u8] = b"auction";

/// `Config` singleton — `[b"config"]`.
pub fn find_config() -> (Pubkey, u8) {
    find_config_in(&PROGRAM_ID)
}
pub fn find_config_in(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

/// `NameRecord` — `[b"name", name_hash]`.
pub fn find_name_record(name_hash: &[u8; 32]) -> (Pubkey, u8) {
    find_name_record_in(name_hash, &PROGRAM_ID)
}
pub fn find_name_record_in(name_hash: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[NAME_SEED, name_hash], program_id)
}

/// `ReverseRecord` — `[b"reverse", owner]`.
pub fn find_reverse(owner: &Pubkey) -> (Pubkey, u8) {
    find_reverse_in(owner, &PROGRAM_ID)
}
pub fn find_reverse_in(owner: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[REVERSE_SEED, owner.as_ref()], program_id)
}

/// `Listing` — `[b"listing", name_hash]`.
pub fn find_listing(name_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[LISTING_SEED, name_hash], &PROGRAM_ID)
}

/// `Offer` — `[b"offer", name_hash, buyer]`.
pub fn find_offer(name_hash: &[u8; 32], buyer: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[OFFER_SEED, name_hash, buyer.as_ref()], &PROGRAM_ID)
}

/// `StakePool` singleton — `[b"stake_pool"]`.
pub fn find_stake_pool() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STAKE_POOL_SEED], &PROGRAM_ID)
}

/// `StakeAccount` — `[b"stake", staker]`.
pub fn find_stake_account(staker: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STAKE_SEED, staker.as_ref()], &PROGRAM_ID)
}

/// `Auction` — `[b"auction", name_hash]`.
pub fn find_auction(name_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[AUCTION_SEED, name_hash], &PROGRAM_ID)
}
