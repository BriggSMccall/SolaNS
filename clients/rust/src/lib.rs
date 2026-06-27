//! # solans-client
//!
//! A dependency-light **Rust client** for the [SOLANS](https://github.com/BriggSMccall/SolaNS)
//! name service (Technical Concept §13): canonical name **hashing**, **PDA**
//! derivation, account **decoding**, and transport-agnostic **resolution** — the
//! same surface as the TS `SolansClient`, for Rust consumers (an on-chain program
//! integrating SOLANS, or an off-chain service / indexer / keeper).
//!
//! Scope is **read + derivation**, not instruction-building: program-to-program
//! calls use the on-chain program's exported Anchor `cpi` module; off-chain writers
//! use the TS client / CLI.
//!
//! ```
//! use solans_client::{name_hash, find_name_record};
//! let h = name_hash("alex", "sol");
//! let (pda, _bump) = find_name_record(&h);
//! ```
mod client;
mod hash;
mod pda;
mod state;

pub use client::{AccountFetcher, SolansClient};
pub use hash::{name_hash, name_hash_for_path, subdomain_hash};
pub use pda::*;
pub use state::{Config, NameRecord, Record, ReverseRecord};

use solana_program::pubkey::Pubkey;

/// The deployed SOLANS program id. This is the **dev/CI** identity (see CLAUDE.md);
/// for a different deployment, build the client with
/// [`SolansClient::new_with_program_id`].
pub const PROGRAM_ID: Pubkey =
    solana_program::pubkey!("AiDB9oh4jMKuGnx4nEseMgW7qpMnswygx6wpFKJbXKfb");

/// Account-decode errors.
#[derive(Debug)]
pub enum Error {
    /// Account data shorter than the 8-byte Anchor discriminator.
    TooShort,
    /// Borsh decode failure.
    Decode(std::io::Error),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::TooShort => write!(f, "account data shorter than the 8-byte discriminator"),
            Error::Decode(e) => write!(f, "borsh decode failed: {e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Decode(e)
    }
}
