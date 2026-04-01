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
    // While tokenized, the recorded `owner` is stale (the NFT may have traded);
    // ownership must move via the NFT, so direct transfer is blocked.
    require!(nr.nft_mint.is_none(), SolansError::Tokenized);
    require!(!nr.listed, SolansError::Listed);
    require!(!nr.transfer_locked, SolansError::TransferLocked);
    nr.owner = new_owner;
    nr.controller = None;
    nr.reverse_set = false;
    Ok(())
}
