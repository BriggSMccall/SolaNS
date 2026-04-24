use crate::constants::*;
use crate::error::SolansError;
use crate::state::NameRecord;
use crate::utils::name_authority_ok;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

#[derive(Accounts)]
pub struct SetHosting<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub name_record: Account<'info, NameRecord>,

    /// Proof of NFT holdership, required only while the name is tokenized: the
    /// holder (not the stale `owner`) manages the hosting attribute — a dynamic
    /// NFT (spec §6.1). Omitted (`None`) for non-tokenized names.
    pub nft_token_account: Option<InterfaceAccount<'info, TokenAccount>>,
}

/// Set (`Some`) or clear (`None`) the hosting content reference (Arweave/IPFS
/// CID or TxID). Authorized for the name's record-level authority (the `owner`,
/// or the NFT holder while tokenized) or its `controller` delegate — the same
/// dynamic-attribute model as `update_record`.
pub fn handler(ctx: Context<SetHosting>, hosting_ref: Option<String>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let nft_ta = ctx.accounts.nft_token_account.as_ref();
    let nr = &mut ctx.accounts.name_record;
    require!(!nr.listed, SolansError::Listed);
    require!(
        name_authority_ok(nr, &authority, nft_ta) || nr.controller == Some(authority),
        SolansError::NotAuthorized
    );
    if let Some(h) = &hosting_ref {
        require!(h.len() <= HOSTING_MAX_LEN, SolansError::RecordTooLong);
    }
    nr.hosting_ref = hosting_ref;
    Ok(())
}
