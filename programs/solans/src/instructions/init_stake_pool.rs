use crate::constants::*;
use crate::error::SolansError;
use crate::state::{Config, StakePool};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Create the `$SOLANS` staking pool and its two pool-owned vaults. Admin only.
/// After this, the admin runs `update_config` to point `Config.staking_vault` at
/// `reward_vault` so the §8.2 staker fee share flows here.
#[derive(Accounts)]
pub struct InitStakePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ SolansError::NotAdmin,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init,
        payer = admin,
        space = 8 + StakePool::INIT_SPACE,
        seeds = [STAKE_POOL_SEED],
        bump
    )]
    pub stake_pool: Box<Account<'info, StakePool>>,

    /// The staked token (`$SOLANS`).
    pub solans_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Reward token; must equal the registry payment mint.
    #[account(constraint = payment_mint.key() == config.payment_mint @ SolansError::InvalidMint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Pool-owned vault for staked `$SOLANS`.
    #[account(
        init,
        payer = admin,
        associated_token::mint = solans_mint,
        associated_token::authority = stake_pool,
        associated_token::token_program = token_program,
    )]
    pub stake_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Pool-owned vault for reward tokens (set `Config.staking_vault` to this).
    #[account(
        init,
        payer = admin,
        associated_token::mint = payment_mint,
        associated_token::authority = stake_pool,
        associated_token::token_program = token_program,
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitStakePool>) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;
    pool.solans_mint = ctx.accounts.solans_mint.key();
    pool.stake_vault = ctx.accounts.stake_vault.key();
    pool.reward_vault = ctx.accounts.reward_vault.key();
    pool.total_staked = 0;
    pool.acc_reward_per_share = 0;
    pool.last_reward_balance = 0;
    pool.bump = ctx.bumps.stake_pool;

    // Point the §8.2 staker fee share at this pool's reward vault.
    ctx.accounts.config.staking_vault = ctx.accounts.reward_vault.key();
    Ok(())
}
