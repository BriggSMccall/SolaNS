//! Transport-agnostic read client — mirrors `clients/sdk/src/client.ts`
//! (`SolansClient`). Decoupled from any RPC via the [`AccountFetcher`] trait, so the
//! whole read path (including the subdomain parent-chain walk) is unit-testable with
//! an in-memory fetcher. See the README for a `solana-client` RPC adapter.
use crate::hash::name_hash_for_path;
use crate::pda;
use crate::state::{NameRecord, Record, ReverseRecord};
use crate::PROGRAM_ID;
use solana_program::pubkey::Pubkey;

/// Loads raw account data by address (the borsh+discriminator bytes), or `None` if
/// the account doesn't exist. Any `Fn(&Pubkey) -> Option<Vec<u8>>` is an
/// `AccountFetcher` via the blanket impl below.
pub trait AccountFetcher {
    fn fetch(&self, address: &Pubkey) -> Option<Vec<u8>>;
}

impl<F: Fn(&Pubkey) -> Option<Vec<u8>>> AccountFetcher for F {
    fn fetch(&self, address: &Pubkey) -> Option<Vec<u8>> {
        self(address)
    }
}

/// High-level read API over an [`AccountFetcher`].
pub struct SolansClient<F: AccountFetcher> {
    fetcher: F,
    program_id: Pubkey,
}

impl<F: AccountFetcher> SolansClient<F> {
    /// Build a client for the default deployed program id ([`PROGRAM_ID`]).
    pub fn new(fetcher: F) -> Self {
        Self {
            fetcher,
            program_id: PROGRAM_ID,
        }
    }

    /// Build a client for a custom (re-deployed) program id.
    pub fn new_with_program_id(fetcher: F, program_id: Pubkey) -> Self {
        Self {
            fetcher,
            program_id,
        }
    }

    /// Resolve a name or subdomain path (`"alex.sol"`, `"pay.alex.sol"`) to its
    /// record, or `None`. The **parent chain is validated**: every ancestor PDA must
    /// still exist and its `registered_at` must equal what the child captured — a
    /// burned parent (gone) or a claimed/re-registered parent (new `registered_at`)
    /// invalidates the whole subtree.
    pub fn resolve(&self, name: &str) -> Option<NameRecord> {
        let hash = name_hash_for_path(name);
        let (pda, _) = pda::find_name_record_in(&hash, &self.program_id);
        let leaf = NameRecord::try_decode(&self.fetcher.fetch(&pda)?).ok()?;

        let mut cursor = leaf.clone();
        while let Some(parent) = cursor.parent {
            let parent_pk = Pubkey::new_from_array(parent);
            let parent_rec = NameRecord::try_decode(&self.fetcher.fetch(&parent_pk)?).ok()?;
            if parent_rec.registered_at != cursor.parent_registered_at {
                return None; // re-registered / claimed -> subtree dead
            }
            cursor = parent_rec;
        }
        Some(leaf)
    }

    /// All key→value records for a name (empty if unregistered).
    pub fn get_records(&self, name: &str) -> Vec<Record> {
        self.resolve(name).map(|r| r.records).unwrap_or_default()
    }

    /// A single record value by key, or `None`.
    pub fn get_record(&self, name: &str, key: &str) -> Option<String> {
        self.get_records(name)
            .into_iter()
            .find(|r| r.key == key)
            .map(|r| r.value)
    }

    /// A chain-address record, e.g. `get_address(name, "SOL")` reads `address.SOL`.
    pub fn get_address(&self, name: &str, chain: &str) -> Option<String> {
        self.get_record(name, &format!("address.{chain}"))
    }

    /// The name's hosted-content reference (§6): `hosting_ref`, else the `content`
    /// record, else the `url` record, else `None`.
    pub fn content_ref(&self, name: &str) -> Option<String> {
        let rec = self.resolve(name)?;
        if let Some(h) = rec.hosting_ref.clone() {
            return Some(h);
        }
        rec.records
            .iter()
            .find(|r| r.key == "content")
            .or_else(|| rec.records.iter().find(|r| r.key == "url"))
            .map(|r| r.value.clone())
    }

    /// Reverse lookup: a wallet → its primary name, round-trip validated
    /// (`reverse.owner == name.owner`). `None` if unset or stale.
    pub fn reverse_lookup(&self, owner: &Pubkey) -> Option<String> {
        let (rpda, _) = pda::find_reverse_in(owner, &self.program_id);
        let rev = ReverseRecord::try_decode(&self.fetcher.fetch(&rpda)?).ok()?;
        let (npda, _) = pda::find_name_record_in(&rev.name_hash, &self.program_id);
        let fwd = NameRecord::try_decode(&self.fetcher.fetch(&npda)?).ok()?;
        if fwd.owner != owner.to_bytes() {
            return None; // stale
        }
        Some(format!("{}.{}", rev.name, rev.tld))
    }
}
