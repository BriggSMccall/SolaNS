use crate::constants::*;
use crate::error::SolansError;
use crate::state::{Config, NameRecord};
use crate::utils::{
    compute_name_hash, distribute_fee_signed, validate_name, validate_tld, validate_years,
    years_to_secs,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// §6.2 auto-renew: a **permissionless keeper** extends a name near expiry by
/// charging the **owner's** payment-mint account, which the owner pre-approved by
/// making the Config PDA its SPL delegate (a standard `spl-token approve`). The
/// keeper pays only tx fees; the fee is split 60/25/10/5 like a manual renew.
#[derive(Accounts)]
pub struct AutoRenew<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,

    /// The SPL delegate authority of `owner_token_account` — signs the charge via
    /// its seeds.
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub name_record: Account<'info, NameRecord>,

    /// The name owner's payment-mint account (Config PDA must be its delegate).
    #[account(
        mut,
        constraint = owner_token_account.owner == name_record.owner @ SolansError::NotOwner,
        token::mint = payment_mint,
        token::token_program = token_program,
    )]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = treasury_token_account.key() == config.treasury_token_account @ SolansError::InvalidTreasury,
        token::token_program = token_program,
    )]
    pub treasury_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = staking_vault.key() == config.staking_vault @ SolansError::InvalidTreasury,
        token::token_program = token_program,
    )]
    pub staking_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = burn_vault.key() == config.burn_vault @ SolansError::InvalidTreasury,
        token::token_program = token_program,
    )]
    pub burn_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(constraint = payment_mint.key() == config.payment_mint @ SolansError::InvalidMint)]
    pub payment_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<AutoRenew>, name: String, tld: String, years: u16) -> Result<()> {
    validate_name(&name)?;
    validate_tld(&tld)?;
    require!(
        ctx.accounts.name_record.name_hash == compute_name_hash(&name, &tld),
        SolansError::NameMismatch
    );

    let config = &ctx.accounts.config;
    validate_years(years, config.min_years, config.max_years)?;
    let amount = config
        .price_for_label(&name)
        .checked_mul(years as u64)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;

    let now = Clock::get()?.unix_timestamp;
    // Only within the renewal window of expiry (so a keeper can't renew early).
    let window_opens = ctx
        .accounts
        .name_record
        .expires_at
        .checked_sub(RENEWAL_WINDOW_SECONDS)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    require!(now >= window_opens, SolansError::AutoRenewTooEarly);

    let bump = config.bump;
    let seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, core::slice::from_ref(&bump)]];
    distribute_fee_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.owner_token_account,
        &ctx.accounts.treasury_token_account,
        &ctx.accounts.staking_vault,
        &ctx.accounts.burn_vault,
        &ctx.accounts.payment_mint,
        &ctx.accounts.config.to_account_info(),
        seeds,
        amount,
        &ctx.accounts.config,
    )?;

    let nr = &mut ctx.accounts.name_record;
    let base = core::cmp::max(nr.expires_at, now);
    nr.expires_at = base
        .checked_add(years_to_secs(years)?)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    Ok(())
}
