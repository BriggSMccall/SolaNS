use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct BurnName<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ SolansError::NotOwner, close = owner)]
    pub name_record: Account<'info, NameRecord>,
}

/// Release a name: close the PDA and return its rent to the owner. Anchor zeroes
/// the account data and drains lamports atomically (revival-safe).
pub fn handler(_ctx: Context<BurnName>) -> Result<()> {
    Ok(())
}
