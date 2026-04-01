use crate::constants::*;
use crate::error::SolansError;
use crate::state::NameRecord;
use crate::utils::{compute_subdomain_hash, validate_name};
use anchor_lang::prelude::*;

/// Create a subdomain (`pay.alex.sol`) under a parent name. The parent owner
/// authorizes it and pays rent; the subdomain may be assigned to any wallet.
/// Free (no registry fee) — the subtree lives under the parent's paid lifetime.
#[derive(Accounts)]
#[instruction(label: String, name_hash: [u8; 32])]
pub struct WrapSubdomain<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: The subdomain's owner. Stored as the child's `owner`; never read.
    pub subdomain_owner: UncheckedAccount<'info>,

    #[account(
        has_one = owner @ SolansError::NotOwner,
        seeds = [NAME_SEED, parent_name.name_hash.as_ref()],
        bump = parent_name.bump,
    )]
    pub parent_name: Account<'info, NameRecord>,

    #[account(
        init,
        payer = owner,
        space = 8 + NameRecord::INIT_SPACE,
        seeds = [NAME_SEED, name_hash.as_ref()],
        bump
    )]
    pub name_record: Account<'info, NameRecord>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WrapSubdomain>, label: String, name_hash: [u8; 32]) -> Result<()> {
    let parent = &ctx.accounts.parent_name;
    // Structural action on the parent — blocked while the parent is tokenized
    // (its `owner` is stale once the NFT trades); redeem first.
    require!(parent.nft_mint.is_none(), SolansError::Tokenized);
    require!(!parent.listed, SolansError::Listed);

    let now = Clock::get()?.unix_timestamp;
    require!(now <= parent.expires_at, SolansError::ParentExpired);

    validate_name(&label)?;
    let depth = parent
        .depth
        .checked_add(1)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    require!(depth <= MAX_SUBDOMAIN_DEPTH, SolansError::TooDeep);
    require!(
        compute_subdomain_hash(&parent.name_hash, &label) == name_hash,
        SolansError::NameMismatch
    );

    let parent_key = parent.key();
    let parent_registered_at = parent.registered_at;
    let parent_expires_at = parent.expires_at;
    let tld = parent.tld.clone();

    let nr = &mut ctx.accounts.name_record;
    nr.owner = ctx.accounts.subdomain_owner.key();
    nr.controller = None;
    nr.name_hash = name_hash;
    nr.tld = tld;
    nr.registered_at = now;
    // Display snapshot; the authoritative lifetime is the live parent chain.
    nr.expires_at = parent_expires_at;
    nr.records = Vec::new();
    nr.resolver = None;
    nr.hosting_ref = None;
    nr.transfer_locked = false;
    nr.reverse_set = false;
    nr.nft_mint = None;
    nr.parent = Some(parent_key);
    nr.parent_registered_at = parent_registered_at;
    nr.depth = depth;
    nr.listed = false;
    nr.bump = ctx.bumps.name_record;
    Ok(())
}
