use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetController<'info> {
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ SolansError::NotOwner)]
    pub name_record: Account<'info, NameRecord>,
}

/// Assign (`Some`) or clear (`None`) the controller delegate. Owner only, and
/// not while tokenized (ownership/delegation move via the NFT — redeem first).
pub fn handler(ctx: Context<SetController>, controller: Option<Pubkey>) -> Result<()> {
    require!(
        ctx.accounts.name_record.nft_mint.is_none(),
        SolansError::Tokenized
    );
    require!(!ctx.accounts.name_record.listed, SolansError::Listed);
    ctx.accounts.name_record.controller = controller;
    Ok(())
}
