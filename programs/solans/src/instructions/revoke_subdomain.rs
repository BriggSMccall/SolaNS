use crate::constants::*;
use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;

/// Reclaim a subdomain: the parent owner closes the child PDA and recovers its
/// rent. (The subdomain's own owner can instead self-`burn_name`.)
#[derive(Accounts)]
pub struct RevokeSubdomain<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        has_one = owner @ SolansError::NotOwner,
        seeds = [NAME_SEED, parent_name.name_hash.as_ref()],
        bump = parent_name.bump,
    )]
    pub parent_name: Account<'info, NameRecord>,

    #[account(
        mut,
        close = owner,
        seeds = [NAME_SEED, name_record.name_hash.as_ref()],
        bump = name_record.bump,
        constraint = name_record.parent == Some(parent_name.key()) @ SolansError::NotParent,
    )]
    pub name_record: Account<'info, NameRecord>,
}

pub fn handler(ctx: Context<RevokeSubdomain>) -> Result<()> {
    // A tokenized child must be redeemed first, else closing it orphans the NFT.
    require!(
        ctx.accounts.name_record.nft_mint.is_none(),
        SolansError::Tokenized
    );
    Ok(())
}
