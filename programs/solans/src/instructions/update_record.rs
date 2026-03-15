use crate::constants::*;
use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateRecord<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub name_record: Account<'info, NameRecord>,
}

/// Set (`Some`) or delete (`None`) a single key -> value record.
/// Authorized for the name's `owner` or its `controller` delegate.
pub fn handler(ctx: Context<UpdateRecord>, key: String, value: Option<String>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let nr = &mut ctx.accounts.name_record;
    require!(
        authority == nr.owner || nr.controller == Some(authority),
        SolansError::NotAuthorized
    );

    require!(key.len() <= KEY_MAX_LEN, SolansError::RecordTooLong);
    match value {
        Some(v) => {
            require!(v.len() <= VALUE_MAX_LEN, SolansError::RecordTooLong);
            nr.upsert_record(key, v)?;
        }
        None => nr.delete_record(&key)?,
    }
    Ok(())
}
