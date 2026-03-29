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
/// the account data and drains lamports atomically (revival-safe). Blocked while
/// tokenized — redeem (burn the NFT) first, else the orphaned NFT would outlive
/// the record. The handler error prevents the `close` from running.
pub fn handler(ctx: Context<BurnName>) -> Result<()> {
    require!(
        ctx.accounts.name_record.nft_mint.is_none(),
        SolansError::Tokenized
    );
    Ok(())
}
