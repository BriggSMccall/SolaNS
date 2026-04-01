use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct LockTransfer<'info> {
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ SolansError::NotOwner)]
    pub name_record: Account<'info, NameRecord>,
}

/// Lock or unlock transfers. Owner only, and not while tokenized. Does not
/// affect `claim_expired`.
pub fn handler(ctx: Context<LockTransfer>, lock: bool) -> Result<()> {
    require!(
        ctx.accounts.name_record.nft_mint.is_none(),
        SolansError::Tokenized
    );
    require!(!ctx.accounts.name_record.listed, SolansError::Listed);
    ctx.accounts.name_record.transfer_locked = lock;
    Ok(())
}
