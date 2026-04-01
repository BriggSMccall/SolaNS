use crate::constants::*;
use crate::error::SolansError;
use crate::state::Config;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SolansError::NotAdmin,
    )]
    pub config: Account<'info, Config>,
}

/// Update the registry's economic parameters. Admin only. Payment mint, treasury,
/// and the admin key itself are immutable in the MVP (rotate via redeploy/migration).
#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<UpdateConfig>,
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
    require!(min_years >= 1 && min_years <= max_years, SolansError::InvalidYears);
    require!(grace_period_seconds >= 0, SolansError::InvalidYears);
    require!(marketplace_fee_bps <= MAX_FEE_BPS, SolansError::InvalidFeeBps);

    let config = &mut ctx.accounts.config;
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
    Ok(())
}
