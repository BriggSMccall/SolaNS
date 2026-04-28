use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;

/// On-chain CPI resolver (§5.2): a permissionless **view** that returns a name's
/// resolved data via the transaction return data, so other programs can
/// `solans::cpi::resolve(name_hash, record_key)` then `get_return_data`.
///
/// - `record_key = None` → the 32-byte owner pubkey (the spec's `→ Pubkey`).
/// - `record_key = Some(key)` → that record's UTF-8 value bytes (empty if absent).
///
/// Validates the passed `name_record` matches the requested `name_hash` (a hash
/// uniquely identifies its PDA) and is not expired (`NameExpired`). Resolves the
/// **leaf** record; for a subdomain, full parent-chain validation stays an
/// off-chain (SDK) concern. No state is mutated.
#[derive(Accounts)]
pub struct Resolve<'info> {
    pub name_record: Account<'info, NameRecord>,
}

pub fn handler(
    ctx: Context<Resolve>,
    name_hash: [u8; 32],
    record_key: Option<String>,
) -> Result<()> {
    let nr = &ctx.accounts.name_record;
    require!(nr.name_hash == name_hash, SolansError::NameMismatch);
    let now = Clock::get()?.unix_timestamp;
    require!(now <= nr.expires_at, SolansError::NameExpired);

    let data: Vec<u8> = match record_key {
        Some(key) => nr
            .records
            .iter()
            .find(|r| r.key == key)
            .map(|r| r.value.as_bytes().to_vec())
            .unwrap_or_default(),
        None => nr.owner.to_bytes().to_vec(),
    };
    set_return_data(&data);
    Ok(())
}
