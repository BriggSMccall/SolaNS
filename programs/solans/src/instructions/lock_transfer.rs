use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct LockTransfer<'info> {
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ SolansError::NotOwner)]
    pub name_record: Account<'info, NameRecord>,
}

/// Lock or unlock transfers. Owner only. Does not affect `claim_expired`.
pub fn handler(ctx: Context<LockTransfer>, lock: bool) -> Result<()> {
    ctx.accounts.name_record.transfer_locked = lock;
    Ok(())
}
