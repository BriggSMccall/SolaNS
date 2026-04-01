use crate::constants::*;
use crate::error::SolansError;
use crate::state::{NameRecord, ReverseRecord};
use crate::utils::compute_name_hash;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetReverse<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ SolansError::NotOwner)]
    pub name_record: Account<'info, NameRecord>,

    // Upsert is safe here: the reverse PDA is keyed by `owner` (the signer), so
    // only the owner can ever create or overwrite their own reverse record, and
    // the handler fully rewrites every field on each call.
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + ReverseRecord::INIT_SPACE,
        seeds = [REVERSE_SEED, owner.key().as_ref()],
        bump
    )]
    pub reverse_record: Account<'info, ReverseRecord>,

    pub system_program: Program<'info, System>,
}

/// Point `owner`'s reverse record at this name (`resolve(pubkey) -> name`). The
/// `name` label is verified against the forward record's hash before it is stored.
pub fn handler(ctx: Context<SetReverse>, name: String) -> Result<()> {
    let nr = &ctx.accounts.name_record;
    require!(nr.nft_mint.is_none(), SolansError::Tokenized);
    require!(!nr.listed, SolansError::Listed);
    // Reverse records store a single label; a subdomain's full path needs a path
    // field + recursive verification (a follow-up). Top-level only for now.
    require!(nr.parent.is_none(), SolansError::Subdomain);
    require!(
        compute_name_hash(&name, &nr.tld) == nr.name_hash,
        SolansError::NameMismatch
    );
    let name_hash = nr.name_hash;
    let tld = nr.tld.clone();

    let reverse = &mut ctx.accounts.reverse_record;
    reverse.owner = ctx.accounts.owner.key();
    reverse.name_hash = name_hash;
    reverse.name = name;
    reverse.tld = tld;
    reverse.bump = ctx.bumps.reverse_record;

    ctx.accounts.name_record.reverse_set = true;
    Ok(())
}
