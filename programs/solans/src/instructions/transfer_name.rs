use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct TransferName<'info> {
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ SolansError::NotOwner)]
    pub name_record: Account<'info, NameRecord>,
}

/// Transfer ownership. Clears the controller and the reverse flag (the old
/// owner's reverse record, if any, becomes stale and is ignored by resolvers).
pub fn handler(ctx: Context<TransferName>, new_owner: Pubkey) -> Result<()> {
    let nr = &mut ctx.accounts.name_record;
    require!(!nr.transfer_locked, SolansError::TransferLocked);
    nr.owner = new_owner;
    nr.controller = None;
    nr.reverse_set = false;
    Ok(())
}
