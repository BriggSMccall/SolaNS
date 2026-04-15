use crate::constants::*;
use crate::error::SolansError;
use crate::state::{Config, StakeAccount, StakePool};
use crate::utils::transfer_tokens_signed;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Claim the staker's pending reward (in the payment mint) without changing the
/// staked amount.
#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    pub staker: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [STAKE_POOL_SEED], bump = stake_pool.bump)]
    pub stake_pool: Box<Account<'info, StakePool>>,

    #[account(mut, seeds = [STAKE_SEED, staker.key().as_ref()], bump = stake_account.bump)]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    /// Staker's reward (payment-mint) destination.
    #[account(mut, token::mint = payment_mint, token::authority = staker, token::token_program = token_program)]
    pub staker_reward_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = stake_pool.reward_vault @ SolansError::InvalidTreasury, token::token_program = token_program)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = config.payment_mint @ SolansError::InvalidMint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ClaimRewards>) -> Result<()> {
    let pool_bump = ctx.accounts.stake_pool.bump;
    let reward_before = ctx.accounts.reward_vault.amount;

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

    {
        let pool = &ctx.accounts.stake_pool;
        let accrued = pool.accrued(ctx.accounts.stake_account.amount)?;
        ctx.accounts.stake_account.reward_debt = accrued;
    }

    ctx.accounts.reward_vault.reload()?;
    ctx.accounts.stake_pool.last_reward_balance = ctx.accounts.reward_vault.amount;
    Ok(())
}
