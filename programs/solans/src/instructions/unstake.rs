use crate::constants::*;
use crate::error::SolansError;
use crate::state::{Config, StakeAccount, StakePool};
use crate::utils::transfer_tokens_signed;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Withdraw staked `$SOLANS`, paying out any pending reward first.
#[derive(Accounts)]
pub struct Unstake<'info> {
    pub staker: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [STAKE_POOL_SEED], bump = stake_pool.bump)]
    pub stake_pool: Box<Account<'info, StakePool>>,

    #[account(mut, seeds = [STAKE_SEED, staker.key().as_ref()], bump = stake_account.bump)]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    /// Staker's `$SOLANS` destination.
    #[account(mut, token::mint = solans_mint, token::authority = staker, token::token_program = token_program)]
    pub staker_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Staker's reward (payment-mint) destination.
    #[account(mut, token::mint = payment_mint, token::authority = staker, token::token_program = token_program)]
    pub staker_reward_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = stake_pool.stake_vault @ SolansError::StakeMintMismatch, token::token_program = token_program)]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = stake_pool.reward_vault @ SolansError::InvalidTreasury, token::token_program = token_program)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = stake_pool.solans_mint @ SolansError::StakeMintMismatch)]
    pub solans_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(address = config.payment_mint @ SolansError::InvalidMint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    require!(
        ctx.accounts.stake_account.amount >= amount,
        SolansError::InsufficientStake
    );

    let pool_bump = ctx.accounts.stake_pool.bump;
    let reward_before = ctx.accounts.reward_vault.amount;

    let pending = {
        let pool = &mut ctx.accounts.stake_pool;
        pool.sync(reward_before)?;
        pool.pending(&ctx.accounts.stake_account)?
    };
    let seeds: &[&[&[u8]]] = &[&[STAKE_POOL_SEED, &[pool_bump]]];

    // Pay the pending reward, then return the staked `$SOLANS` (both pool-signed).
    transfer_tokens_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.reward_vault,
        &ctx.accounts.staker_reward_account,
        &ctx.accounts.payment_mint,
        &ctx.accounts.stake_pool.to_account_info(),
        seeds,
        pending,
    )?;
    transfer_tokens_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.stake_vault,
        &ctx.accounts.staker_token_account,
        &ctx.accounts.solans_mint,
        &ctx.accounts.stake_pool.to_account_info(),
        seeds,
        amount,
    )?;

    {
        let pool = &mut ctx.accounts.stake_pool;
        pool.total_staked = pool
            .total_staked
            .checked_sub(amount)
            .ok_or_else(|| error!(SolansError::MathOverflow))?;
        let stake = &mut ctx.accounts.stake_account;
        stake.amount = stake
            .amount
            .checked_sub(amount)
            .ok_or_else(|| error!(SolansError::MathOverflow))?;
        stake.reward_debt = pool.accrued(stake.amount)?;
    }

    ctx.accounts.reward_vault.reload()?;
    ctx.accounts.stake_pool.last_reward_balance = ctx.accounts.reward_vault.amount;
    Ok(())
}
