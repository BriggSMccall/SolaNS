use crate::constants::*;
use crate::error::SolansError;
use crate::state::{Config, NameRecord};
use crate::utils::{
    charge_fee, compute_name_hash, validate_name, validate_tld, validate_years, years_to_secs,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct RenewName<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub name_record: Account<'info, NameRecord>,

    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = payer,
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

pub fn handler(ctx: Context<RenewName>, name: String, tld: String, years: u16) -> Result<()> {
    validate_name(&name)?;
    validate_tld(&tld)?;
    require!(
        ctx.accounts.name_record.name_hash == compute_name_hash(&name, &tld),
        SolansError::NameMismatch
    );

    let config = &ctx.accounts.config;
    validate_years(years, config.min_years, config.max_years)?;
    let amount = config
        .price_for_len(name.len())
        .checked_mul(years as u64)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;

    charge_fee(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_token_account,
        &ctx.accounts.treasury_token_account,
        &ctx.accounts.payment_mint,
        &ctx.accounts.payer,
        amount,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let nr = &mut ctx.accounts.name_record;
    // Extend from the later of the current expiry and now, so a lapsed-but-in-grace
    // name renews forward from now rather than from a stale timestamp.
    let base = core::cmp::max(nr.expires_at, now);
    nr.expires_at = base
        .checked_add(years_to_secs(years)?)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    Ok(())
}
