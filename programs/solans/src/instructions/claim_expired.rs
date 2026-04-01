use crate::constants::*;
use crate::error::SolansError;
use crate::state::{Config, NameRecord};
use crate::utils::{
    charge_fee, compute_name_hash, validate_name, validate_tld, validate_years, years_to_secs,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct ClaimExpired<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub name_record: Account<'info, NameRecord>,

    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = claimer,
        token::token_program = token_program,
    )]
    pub payer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury_token_account.key() == config.treasury_token_account @ SolansError::InvalidTreasury,
        token::token_program = token_program,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(constraint = payment_mint.key() == config.payment_mint @ SolansError::InvalidMint)]
    pub payment_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Take over a name that is past `expires_at + grace_period`. A transfer lock on
/// the previous owner does NOT block this (an expired name is fair game).
pub fn handler(ctx: Context<ClaimExpired>, name: String, tld: String, years: u16) -> Result<()> {
    validate_name(&name)?;
    validate_tld(&tld)?;
    // Subdomains aren't independently claimable — they live and die with the
    // parent (revoked by the parent owner, not re-registered here). Checked
    // before the hash match so the rejection is a clear `Subdomain`.
    require!(
        ctx.accounts.name_record.parent.is_none(),
        SolansError::Subdomain
    );
    require!(
        ctx.accounts.name_record.name_hash == compute_name_hash(&name, &tld),
        SolansError::NameMismatch
    );

    let now = Clock::get()?.unix_timestamp;
    let config = &ctx.accounts.config;
    let grace_end = ctx
        .accounts
        .name_record
        .expires_at
        .checked_add(config.grace_period_seconds)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    require!(now > grace_end, SolansError::NotExpired);

    validate_years(years, config.min_years, config.max_years)?;
    let amount = config
        .price_for_label(&name)
        .checked_mul(years as u64)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;

    charge_fee(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_token_account,
        &ctx.accounts.treasury_token_account,
        &ctx.accounts.payment_mint,
        &ctx.accounts.claimer,
        amount,
    )?;

    let expires_at = now
        .checked_add(years_to_secs(years)?)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;

    let nr = &mut ctx.accounts.name_record;
    nr.owner = ctx.accounts.claimer.key();
    nr.controller = None;
    nr.registered_at = now;
    nr.expires_at = expires_at;
    nr.records = Vec::new();
    nr.resolver = None;
    nr.hosting_ref = None;
    nr.transfer_locked = false;
    nr.reverse_set = false;
    // A lapsed tokenized name's NFT is orphaned: the PDA is reclaimed here, so
    // the old NFT no longer controls anything (a resolver round-trip ignores it).
    nr.nft_mint = None;
    // Rewriting `registered_at` above already invalidates any old subtree; this
    // record is top-level (guarded above), so keep the subdomain fields cleared.
    nr.parent = None;
    nr.parent_registered_at = 0;
    nr.depth = 0;
    // A re-registered name drops any stale listing (the old Listing PDA, if any,
    // becomes unbuyable: buy_name checks `owner == listing.seller`).
    nr.listed = false;
    Ok(())
}
