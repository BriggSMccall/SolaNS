use crate::constants::*;
use crate::error::SolansError;
use crate::state::Config;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Create the §8.1 buyback burn vault — a payment-mint ATA owned by the `Config`
/// PDA — and repoint `Config.burn_vault` at it so the §8.2 burn share accumulates
/// in a program-controlled escrow the permissionless `buyback_burn` can drain.
/// Also records `Config.solans_mint` (the `$SOLANS` token). Admin only.
#[derive(Accounts)]
pub struct InitBurnPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SolansError::NotAdmin,
    )]
    pub config: Box<Account<'info, Config>>,

    /// The `$SOLANS` token mint (recorded into `Config.solans_mint`).
    pub solans_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Must equal the registry payment mint.
    #[account(constraint = payment_mint.key() == config.payment_mint @ SolansError::InvalidMint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Config-PDA-owned vault for the burn (buyback) fee share.
    #[account(
        init,
        payer = admin,
        associated_token::mint = payment_mint,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    pub burn_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitBurnPool>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.burn_vault = ctx.accounts.burn_vault.key();
    config.solans_mint = ctx.accounts.solans_mint.key();
    Ok(())
}
