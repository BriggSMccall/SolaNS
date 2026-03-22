use crate::constants::*;
use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetHosting<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub name_record: Account<'info, NameRecord>,
}

/// Set (`Some`) or clear (`None`) the hosting content reference (Arweave/IPFS
/// CID or TxID). Authorized for the name's `owner` or its `controller` delegate.
pub fn handler(ctx: Context<SetHosting>, hosting_ref: Option<String>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let nr = &mut ctx.accounts.name_record;
    require!(
        authority == nr.owner || nr.controller == Some(authority),
        SolansError::NotAuthorized
    );
    if let Some(h) = &hosting_ref {
        require!(h.len() <= HOSTING_MAX_LEN, SolansError::RecordTooLong);
    }
    nr.hosting_ref = hosting_ref;
    Ok(())
}
