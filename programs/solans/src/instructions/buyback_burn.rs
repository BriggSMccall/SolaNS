use crate::constants::*;
use crate::error::SolansError;
use crate::events::BuybackBurn as BuybackBurnEvent;
use crate::state::Config;
use crate::utils::{burn_tokens, transfer_tokens_signed};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// §8.1 buyback-and-burn keeper — **permissionless**. The keeper burns
/// `solans_amount` `$SOLANS` from their own account and is reimbursed
/// `solans_amount × SCALE / rate` of the payment mint out of the Config-PDA-owned
/// `burn_vault` (capped at its balance). The keeper sources the `$SOLANS` off-chain
/// (any DEX); on-chain we only burn + reimburse, so the burn vault is steadily
/// converted into burned `$SOLANS` supply. The admin tunes `Config.solans_rate` to
/// track market — at/near market price this is incentive-compatible.
#[derive(Accounts)]
pub struct BuybackBurn<'info> {
    pub keeper: Signer<'info>,

    /// Read-only; signs the vault payout via its seeds.
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        address = config.burn_vault @ SolansError::InvalidTreasury,
        token::mint = payment_mint,
        token::authority = config,
        token::token_program = token_program,
    )]
    pub burn_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Keeper's payment-mint account; receives the reimbursement.
    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = keeper,
        token::token_program = token_program,
    )]
    pub keeper_payment_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Keeper's `$SOLANS` account; the burn debits this.
    #[account(
        mut,
        token::mint = solans_mint,
        token::authority = keeper,
        token::token_program = token_program,
    )]
    pub keeper_solans_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        address = config.solans_mint @ SolansError::InvalidMint,
        mint::token_program = token_program,
    )]
    pub solans_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = payment_mint.key() == config.payment_mint @ SolansError::InvalidMint,
        mint::token_program = token_program,
    )]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<BuybackBurn>, solans_amount: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(config.solans_enabled(), SolansError::SolansNotConfigured);
    require!(solans_amount > 0, SolansError::InsufficientBurnVault);

    let usdc_out = config.buyback_usdc(solans_amount)?;
    require!(usdc_out > 0, SolansError::InsufficientBurnVault);
    require!(
        usdc_out <= ctx.accounts.burn_vault.amount,
        SolansError::InsufficientBurnVault
    );

    // Reimburse the keeper out of the Config-PDA-owned burn vault (PDA signs).
    let bump = config.bump;
    let seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, core::slice::from_ref(&bump)]];
    transfer_tokens_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.burn_vault,
        &ctx.accounts.keeper_payment_account,
        &ctx.accounts.payment_mint,
        &ctx.accounts.config.to_account_info(),
        seeds,
        usdc_out,
    )?;

    // Burn the keeper's `$SOLANS` (keeper signs their own account).
    burn_tokens(
        &ctx.accounts.token_program,
        &ctx.accounts.solans_mint,
        &ctx.accounts.keeper_solans_account,
        &ctx.accounts.keeper,
        solans_amount,
    )?;

    emit!(BuybackBurnEvent {
        keeper: ctx.accounts.keeper.key(),
        solans_burned: solans_amount,
        usdc_reimbursed: usdc_out,
    });
    Ok(())
}
