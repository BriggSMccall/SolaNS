use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetController<'info> {
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ SolansError::NotOwner)]
    pub name_record: Account<'info, NameRecord>,
}

/// Assign (`Some`) or clear (`None`) the controller delegate. Owner only.
pub fn handler(ctx: Context<SetController>, controller: Option<Pubkey>) -> Result<()> {
    ctx.accounts.name_record.controller = controller;
    Ok(())
}
