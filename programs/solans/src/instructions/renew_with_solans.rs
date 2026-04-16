use crate::constants::*;
use crate::error::SolansError;
use crate::events::RenewedWithSolans;
use crate::state::{Config, NameRecord};
use crate::utils::{
    burn_tokens, compute_name_hash, validate_name, validate_tld, validate_years, years_to_secs,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Renew (extend) a name by paying the fee in `$SOLANS` at the §8.1 discount; the
/// `$SOLANS` is burned. Mirrors `renew_name`'s extension logic.
#[derive(Accounts)]
pub struct RenewWithSolans<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub name_record: Account<'info, NameRecord>,

    /// Payer's `$SOLANS` account; the discounted fee is burned from here.
    #[account(
        mut,
        token::mint = solans_mint,
        token::authority = payer,
        token::token_program = token_program,
    )]
    pub payer_solans_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = config.solans_mint @ SolansError::InvalidMint,
        mint::token_program = token_program,
    )]
    pub solans_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<RenewWithSolans>, name: String, tld: String, years: u16) -> Result<()> {
    validate_name(&name)?;
    validate_tld(&tld)?;
    require!(
        ctx.accounts.name_record.name_hash == compute_name_hash(&name, &tld),
        SolansError::NameMismatch
    );

    let config = &ctx.accounts.config;
    require!(config.solans_enabled(), SolansError::SolansNotConfigured);
    validate_years(years, config.min_years, config.max_years)?;
    let usdc_fee = config
        .price_for_label(&name)
        .checked_mul(years as u64)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    let solans_burned = config.solans_fee(usdc_fee)?;

    burn_tokens(
        &ctx.accounts.token_program,
        &ctx.accounts.solans_mint,
        &ctx.accounts.payer_solans_account,
        &ctx.accounts.payer,
        solans_burned,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let nr = &mut ctx.accounts.name_record;
    // Extend from the later of the current expiry and now (matches `renew_name`).
    let base = core::cmp::max(nr.expires_at, now);
    nr.expires_at = base
        .checked_add(years_to_secs(years)?)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;

    emit!(RenewedWithSolans {
        name_hash: nr.name_hash,
        payer: ctx.accounts.payer.key(),
        solans_burned,
    });
    Ok(())
}
