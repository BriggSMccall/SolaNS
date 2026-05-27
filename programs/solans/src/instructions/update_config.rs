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

/// Update the registry's economic parameters. Admin only. The admin key rotates
/// via `transfer_admin` (e.g. to a multisig/DAO); payment mint + treasury stay
/// immutable (changing them mid-life would strand fees/escrows — a redeploy concern).
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
    staking_fee_bps: u16,
    referral_fee_bps: u16,
    burn_fee_bps: u16,
) -> Result<()> {
    require!(min_years >= 1 && min_years <= max_years, SolansError::InvalidYears);
    require!(grace_period_seconds >= 0, SolansError::InvalidYears);
    // Every tier must be priced (a zero would let names register/renew for free — audit M-1).
    require!(
        price_1 > 0 && price_2 > 0 && price_3 > 0 && price_4 > 0 && price_5plus > 0 && price_numeric > 0,
        SolansError::InvalidPrice
    );
    require!(marketplace_fee_bps <= MAX_FEE_BPS, SolansError::InvalidFeeBps);
    require!(
        (staking_fee_bps as u32 + referral_fee_bps as u32 + burn_fee_bps as u32)
            < BPS_DENOMINATOR as u32,
        SolansError::InvalidFeeSplit
    );

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
    config.staking_fee_bps = staking_fee_bps;
    config.referral_fee_bps = referral_fee_bps;
    config.burn_fee_bps = burn_fee_bps;
    Ok(())
}
