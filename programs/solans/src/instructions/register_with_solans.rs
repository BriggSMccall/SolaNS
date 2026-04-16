use crate::constants::*;
use crate::error::SolansError;
use crate::events::RegisteredWithSolans;
use crate::state::{Config, NameRecord};
use crate::utils::{
    burn_tokens, compute_name_hash, init_top_level_record, validate_name, validate_tld,
    validate_years, years_to_secs,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Register a name by paying the fee in `$SOLANS` at the §8.1 discount; the
/// `$SOLANS` is burned on the spot (deflationary). Mirrors `register_name` but
/// swaps the §8.2 fee distribution for a burn of the payer's own `$SOLANS`.
#[derive(Accounts)]
#[instruction(name: String, tld: String, name_hash: [u8; 32])]
pub struct RegisterWithSolans<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The wallet the name is registered to. Stored as `owner`; never read or written.
    pub owner: UncheckedAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        space = 8 + NameRecord::INIT_SPACE,
        seeds = [NAME_SEED, name_hash.as_ref()],
        bump
    )]
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
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterWithSolans>,
    name: String,
    tld: String,
    name_hash: [u8; 32],
    years: u16,
) -> Result<()> {
    validate_name(&name)?;
    validate_tld(&tld)?;
    require!(
        compute_name_hash(&name, &tld) == name_hash,
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
    let expires_at = now
        .checked_add(years_to_secs(years)?)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;

    init_top_level_record(
        &mut ctx.accounts.name_record,
        ctx.accounts.owner.key(),
        name_hash,
        tld,
        now,
        expires_at,
        ctx.bumps.name_record,
    );

    emit!(RegisteredWithSolans {
        name_hash,
        payer: ctx.accounts.payer.key(),
        solans_burned,
    });
    Ok(())
}
