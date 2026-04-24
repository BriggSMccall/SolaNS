use crate::error::SolansError;
use crate::state::NameRecord;
use crate::utils::name_authority_ok;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

#[derive(Accounts)]
pub struct SetResolver<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub name_record: Account<'info, NameRecord>,

    /// Proof of NFT holdership, required only while the name is tokenized: the
    /// holder (not the stale `owner`) manages the resolver attribute — a dynamic
    /// NFT (spec §6.1). Omitted (`None`) for non-tokenized names.
    pub nft_token_account: Option<InterfaceAccount<'info, TokenAccount>>,
}

/// Set (`Some`) or clear (`None`) a custom resolver program for the name.
/// Authorized for the `owner`, or the NFT holder while tokenized (spec §3:
/// resolver = owner, extended to the dynamic-NFT holder).
pub fn handler(ctx: Context<SetResolver>, resolver: Option<Pubkey>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let nft_ta = ctx.accounts.nft_token_account.as_ref();
    let nr = &mut ctx.accounts.name_record;
    require!(!nr.listed, SolansError::Listed);
    require!(
        name_authority_ok(nr, &authority, nft_ta),
        SolansError::NotAuthorized
    );
    nr.resolver = resolver;
    Ok(())
}
