//! Borsh mirrors of the on-chain accounts (`programs/solans/src/state/*.rs`),
//! field-for-field. Pubkeys are stored as raw `[u8; 32]` (native borsh, no feature
//! gymnastics) with `Pubkey` accessors. `try_decode` skips the 8-byte Anchor
//! discriminator and uses borsh `deserialize` (not `try_from_slice`) so it ignores
//! the trailing zero-padding of a max-allocated on-chain account.
use crate::Error;
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

const DISCRIMINATOR_LEN: usize = 8;

fn decode<T: BorshDeserialize>(data: &[u8]) -> Result<T, Error> {
    let mut body = data.get(DISCRIMINATOR_LEN..).ok_or(Error::TooShort)?;
    Ok(T::deserialize(&mut body)?)
}

/// A single key→value record stored on a name.
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub key: String,
    pub value: String,
}

/// The canonical per-name account (`state/name_record.rs`).
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
pub struct NameRecord {
    pub owner: [u8; 32],
    pub controller: Option<[u8; 32]>,
    pub name_hash: [u8; 32],
    pub tld: String,
    pub registered_at: i64,
    pub expires_at: i64,
    pub records: Vec<Record>,
    pub resolver: Option<[u8; 32]>,
    pub hosting_ref: Option<String>,
    pub transfer_locked: bool,
    pub reverse_set: bool,
    pub nft_mint: Option<[u8; 32]>,
    pub parent: Option<[u8; 32]>,
    pub parent_registered_at: i64,
    pub depth: u8,
    pub listed: bool,
    pub bump: u8,
}

impl NameRecord {
    pub fn try_decode(data: &[u8]) -> Result<Self, Error> {
        decode(data)
    }
    pub fn owner(&self) -> Pubkey {
        Pubkey::new_from_array(self.owner)
    }
    pub fn controller(&self) -> Option<Pubkey> {
        self.controller.map(Pubkey::new_from_array)
    }
    pub fn resolver(&self) -> Option<Pubkey> {
        self.resolver.map(Pubkey::new_from_array)
    }
    pub fn nft_mint(&self) -> Option<Pubkey> {
        self.nft_mint.map(Pubkey::new_from_array)
    }
    pub fn parent(&self) -> Option<Pubkey> {
        self.parent.map(Pubkey::new_from_array)
    }
    /// True while the name is held as an NFT (record-level auth is by holdership).
    pub fn tokenized(&self) -> bool {
        self.nft_mint.is_some()
    }
}

/// The registry config singleton (`state/config.rs`).
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
pub struct Config {
    pub admin: [u8; 32],
    pub payment_mint: [u8; 32],
    pub treasury_token_account: [u8; 32],
    pub price_1: u64,
    pub price_2: u64,
    pub price_3: u64,
    pub price_4: u64,
    pub price_5plus: u64,
    pub price_numeric: u64,
    pub grace_period_seconds: i64,
    pub min_years: u16,
    pub max_years: u16,
    pub sol_treasury: [u8; 32],
    pub marketplace_fee_bps: u16,
    pub staking_vault: [u8; 32],
    pub burn_vault: [u8; 32],
    pub staking_fee_bps: u16,
    pub referral_fee_bps: u16,
    pub burn_fee_bps: u16,
    pub solans_mint: [u8; 32],
    pub solans_rate: u64,
    pub solans_discount_bps: u16,
    pub bump: u8,
}

impl Config {
    pub fn try_decode(data: &[u8]) -> Result<Self, Error> {
        decode(data)
    }
    pub fn admin(&self) -> Pubkey {
        Pubkey::new_from_array(self.admin)
    }
    pub fn payment_mint(&self) -> Pubkey {
        Pubkey::new_from_array(self.payment_mint)
    }
    /// Per-year price for a validated label — mirrors `Config::price_for_label`
    /// (§9.2): emoji/non-ASCII → 2× the code-point length tier; all-digit ≤4 →
    /// the numeric premium; else the byte-length tier.
    pub fn price_for_label(&self, label: &str) -> u64 {
        let price_for_len = |len: usize| match len {
            1 => self.price_1,
            2 => self.price_2,
            3 => self.price_3,
            4 => self.price_4,
            _ => self.price_5plus,
        };
        if !label.is_ascii() {
            return price_for_len(label.chars().count()).saturating_mul(2);
        }
        let b = label.as_bytes();
        if b.len() <= 4 && b.iter().all(|c| c.is_ascii_digit()) {
            self.price_numeric
        } else {
            price_for_len(b.len())
        }
    }
}

/// A wallet's primary-name pointer (`state/reverse_record.rs`).
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
pub struct ReverseRecord {
    pub owner: [u8; 32],
    pub name_hash: [u8; 32],
    pub name: String,
    pub tld: String,
    pub bump: u8,
}

impl ReverseRecord {
    pub fn try_decode(data: &[u8]) -> Result<Self, Error> {
        decode(data)
    }
    pub fn owner(&self) -> Pubkey {
        Pubkey::new_from_array(self.owner)
    }
}
