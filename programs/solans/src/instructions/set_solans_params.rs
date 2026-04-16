use crate::constants::*;
use crate::error::SolansError;
use crate::state::Config;
use anchor_lang::prelude::*;

/// Set/tune the §8.1 pay-in-`$SOLANS` economics: `solans_rate` (`$SOLANS` base
/// units per 1 payment-mint base unit, scaled by `SOLANS_RATE_SCALE`) and the
/// pay-in discount. Admin only — the admin re-runs this as the market moves.
#[derive(Accounts)]
pub struct SetSolansParams<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SolansError::NotAdmin,
    )]
    pub config: Account<'info, Config>,
}

pub fn handler(
    ctx: Context<SetSolansParams>,
    solans_rate: u64,
    solans_discount_bps: u16,
) -> Result<()> {
    require!(
        (solans_discount_bps as u64) < BPS_DENOMINATOR,
        SolansError::InvalidDiscount
    );
    let config = &mut ctx.accounts.config;
    config.solans_rate = solans_rate;
    config.solans_discount_bps = solans_discount_bps;
    Ok(())
}
