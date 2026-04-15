use crate::constants::*;
use crate::error::SolansError;
use crate::state::{Config, StakeAccount, StakePool};
use crate::utils::{transfer_tokens, transfer_tokens_signed};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Stake `$SOLANS` into the pool. Settles any pending reward first (so the
/// position's `reward_debt` re-bases cleanly), then deposits the stake.
#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [STAKE_POOL_SEED], bump = stake_pool.bump)]
    pub stake_pool: Box<Account<'info, StakePool>>,

    #[account(
        init_if_needed,
        payer = staker,
        space = 8 + StakeAccount::INIT_SPACE,
        seeds = [STAKE_SEED, staker.key().as_ref()],
        bump
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    /// Staker's `$SOLANS` source.
    #[account(mut, token::mint = solans_mint, token::authority = staker, token::token_program = token_program)]
    pub staker_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Staker's reward (payment-mint) destination for the settled pending reward.
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
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, SolansError::InsufficientStake);

    let pool_bump = ctx.accounts.stake_pool.bump;
    let reward_before = ctx.accounts.reward_vault.amount;

    // Initialize the position on the first stake.
    {
        let stake = &mut ctx.accounts.stake_account;
        if stake.owner == Pubkey::default() {
            stake.owner = ctx.accounts.staker.key();
            stake.bump = ctx.bumps.stake_account;
        }
    }

    // Sync new fee deposits into the per-share value, then settle the pending
    // reward against the *current* stake before it changes.
    let pending = {
        let pool = &mut ctx.accounts.stake_pool;
        pool.sync(reward_before)?;
        pool.pending(&ctx.accounts.stake_account)?
    };
    let seeds: &[&[&[u8]]] = &[&[STAKE_POOL_SEED, &[pool_bump]]];
    transfer_tokens_signed(
        &ctx.accounts.token_program,
        &ctx.accounts.reward_vault,
        &ctx.accounts.staker_reward_account,
        &ctx.accounts.payment_mint,
        &ctx.accounts.stake_pool.to_account_info(),
        seeds,
        pending,
    )?;

    // Pull the staked `$SOLANS` into the pool's stake vault.
    transfer_tokens(
        &ctx.accounts.token_program,
        &ctx.accounts.staker_token_account,
        &ctx.accounts.stake_vault,
        &ctx.accounts.solans_mint,
        &ctx.accounts.staker,
        amount,
    )?;

    {
        let pool = &mut ctx.accounts.stake_pool;
        pool.total_staked = pool
            .total_staked
            .checked_add(amount)
            .ok_or_else(|| error!(SolansError::MathOverflow))?;
        let stake = &mut ctx.accounts.stake_account;
        stake.amount = stake
            .amount
            .checked_add(amount)
            .ok_or_else(|| error!(SolansError::MathOverflow))?;
        stake.reward_debt = pool.accrued(stake.amount)?;
    }

    // The pending payout reduced reward_vault — re-baseline the watermark.
    ctx.accounts.reward_vault.reload()?;
    ctx.accounts.stake_pool.last_reward_balance = ctx.accounts.reward_vault.amount;
    Ok(())
}
