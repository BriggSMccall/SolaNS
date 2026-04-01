use crate::constants::*;
use anchor_lang::prelude::*;

/// A single key -> value record stored inside a [`NameRecord`].
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Record {
    #[max_len(KEY_MAX_LEN)]
    pub key: String,
    #[max_len(VALUE_MAX_LEN)]
    pub value: String,
}

/// The core name account (PDA, seeds = [b"name", name_hash]).
///
/// Ownership is PDA-native: whoever is `owner` controls the name. Records are
/// allocated to their maximum size up front (fixed allocation) so mutations
/// never need to reallocate.
#[account]
#[derive(InitSpace)]
pub struct NameRecord {
    /// Current owner of the name.
    pub owner: Pubkey,
    /// Optional delegate allowed to manage records (not transfer/ownership).
    pub controller: Option<Pubkey>,
    /// sha256(name + "." + tld) — the canonical key (also the PDA seed).
    pub name_hash: [u8; 32],
    /// Top-level domain, e.g. "sol".
    #[max_len(TLD_MAX_LEN)]
    pub tld: String,
    /// Unix timestamp of (most recent) registration.
    pub registered_at: i64,
    /// Unix timestamp of expiration.
    pub expires_at: i64,
    /// Arbitrary key -> value records.
    #[max_len(MAX_RECORDS)]
    pub records: Vec<Record>,
    /// Optional custom resolver program (reserved; setter deferred).
    pub resolver: Option<Pubkey>,
    /// Optional hosting content ref / CID (reserved; setter deferred).
    #[max_len(HOSTING_MAX_LEN)]
    pub hosting_ref: Option<String>,
    /// When true, `transfer_name` is rejected.
    pub transfer_locked: bool,
    /// Whether the owner has set a reverse record pointing here.
    pub reverse_set: bool,
    /// The NFT mint when the name is tokenized (`Some`), else `None`. While
    /// tokenized, holdership of this mint — not the `owner` field — is what
    /// authorizes record-level changes; structural changes require `redeem_name`
    /// first. The PDA remains the canonical record (expiry, records live here).
    pub nft_mint: Option<Pubkey>,
    /// The parent name's PDA when this is a subdomain (`Some`), else `None` for a
    /// top-level name. Resolution follows this pointer up to the root.
    pub parent: Option<Pubkey>,
    /// The parent's `registered_at` captured at creation. Resolution requires it
    /// still equals the live parent's `registered_at`; a claim or burn+re-register
    /// rewrites the parent's `registered_at` and so invalidates the whole subtree.
    pub parent_registered_at: i64,
    /// Subdomain depth: 0 for a top-level name, +1 per level (capped on creation).
    pub depth: u8,
    /// When true, the name is listed for sale on the native marketplace and is
    /// frozen: owner-gated mutations are rejected until `buy_name`/`cancel_listing`.
    /// Non-custodial — the seller keeps `owner`; the lock is what protects buyers.
    pub listed: bool,
    /// Canonical PDA bump.
    pub bump: u8,
}

impl NameRecord {
    /// Upsert a record, returning an error if the store would overflow.
    pub fn upsert_record(&mut self, key: String, value: String) -> Result<()> {
        if let Some(existing) = self.records.iter_mut().find(|r| r.key == key) {
            existing.value = value;
        } else {
            require!(
                self.records.len() < MAX_RECORDS,
                crate::error::SolansError::TooManyRecords
            );
            self.records.push(Record { key, value });
        }
        Ok(())
    }

    /// Delete a record by key, returning an error if it is absent.
    pub fn delete_record(&mut self, key: &str) -> Result<()> {
        let before = self.records.len();
        self.records.retain(|r| r.key != key);
        require!(
            self.records.len() != before,
            crate::error::SolansError::RecordNotFound
        );
        Ok(())
    }
}
