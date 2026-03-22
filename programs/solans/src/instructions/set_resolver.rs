use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetResolver<'info> {
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ SolansError::NotOwner)]
    pub name_record: Account<'info, NameRecord>,
}

/// Set (`Some`) or clear (`None`) a custom resolver program for the name. Owner only.
pub fn handler(ctx: Context<SetResolver>, resolver: Option<Pubkey>) -> Result<()> {
    ctx.accounts.name_record.resolver = resolver;
    Ok(())
}
