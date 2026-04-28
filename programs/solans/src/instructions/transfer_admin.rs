use crate::constants::*;
use crate::error::SolansError;
use crate::events::AdminTransferred;
use crate::state::Config;
use anchor_lang::prelude::*;

/// Rotate the config admin authority (e.g. hand it to a multisig / DAO). Admin
/// only. Treasury and payment mint stay immutable (changing them mid-life would
/// strand fees/escrows — that's a redeploy/migration concern, not rotation).
#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SolansError::NotAdmin,
    )]
    pub config: Account<'info, Config>,
}

pub fn handler(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_admin = config.admin;
    config.admin = new_admin;
    emit!(AdminTransferred { old_admin, new_admin });
    Ok(())
}
