use crate::constants::*;
use crate::error::SolansError;
use crate::state::NameRecord;
use crate::utils::name_authority_ok;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

#[derive(Accounts)]
pub struct UpdateRecord<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub name_record: Account<'info, NameRecord>,

    /// Proof of NFT holdership, required only while the name is tokenized: the
    /// holder (not the stale `owner`) manages records — i.e. a dynamic NFT.
    /// Omitted (`None`) for non-tokenized names. Validated in `name_authority_ok`.
    pub nft_token_account: Option<InterfaceAccount<'info, TokenAccount>>,
}

/// Set (`Some`) or delete (`None`) a single key -> value record. Authorized for
/// the name's record-level authority (the `owner`, or the NFT holder while
/// tokenized) or its `controller` delegate.
pub fn handler(ctx: Context<UpdateRecord>, key: String, value: Option<String>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let nft_ta = ctx.accounts.nft_token_account.as_ref();
    let nr = &mut ctx.accounts.name_record;
    require!(
        name_authority_ok(nr, &authority, nft_ta) || nr.controller == Some(authority),
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
