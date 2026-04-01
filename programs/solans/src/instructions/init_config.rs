use crate::constants::*;
use crate::error::SolansError;
use crate::state::Config;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    /// Payment mint (SPL Token or Token-2022).
    pub payment_mint: InterfaceAccount<'info, Mint>,

    /// Treasury token account that will receive fees; must be for `payment_mint`.
    #[account(
        token::mint = payment_mint,
        token::token_program = token_program,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<InitConfig>,
    price_1: u64,
    price_2: u64,
    price_3: u64,
    price_4: u64,
    price_5plus: u64,
    price_numeric: u64,
    grace_period_seconds: i64,
    min_years: u16,
    max_years: u16,
    sol_treasury: Pubkey,
    marketplace_fee_bps: u16,
) -> Result<()> {
    require!(
        min_years >= 1 && min_years <= max_years,
        SolansError::InvalidYears
    );
    require!(grace_period_seconds >= 0, SolansError::InvalidYears);
    require!(
        marketplace_fee_bps <= MAX_FEE_BPS,
        SolansError::InvalidFeeBps
    );

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.payment_mint = ctx.accounts.payment_mint.key();
    config.treasury_token_account = ctx.accounts.treasury_token_account.key();
    config.price_1 = price_1;
    config.price_2 = price_2;
    config.price_3 = price_3;
    config.price_4 = price_4;
    config.price_5plus = price_5plus;
    config.price_numeric = price_numeric;
    config.grace_period_seconds = grace_period_seconds;
    config.min_years = min_years;
    config.max_years = max_years;
    config.sol_treasury = sol_treasury;
    config.marketplace_fee_bps = marketplace_fee_bps;
    config.bump = ctx.bumps.config;
    Ok(())
}
