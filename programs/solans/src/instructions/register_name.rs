use crate::constants::*;
use crate::error::SolansError;
use crate::state::{Config, NameRecord};
use crate::utils::{
    charge_fee, compute_name_hash, validate_name, validate_tld, validate_years, years_to_secs,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
#[instruction(name: String, tld: String, name_hash: [u8; 32])]
pub struct RegisterName<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The wallet the name is registered to. Stored as `owner`; never read or written.
    pub owner: UncheckedAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        space = 8 + NameRecord::INIT_SPACE,
        seeds = [NAME_SEED, name_hash.as_ref()],
        bump
    )]
    pub name_record: Account<'info, NameRecord>,

    #[account(
        mut,
        token::mint = payment_mint,
        token::authority = payer,
        token::token_program = token_program,
    )]
    pub payer_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury_token_account.key() == config.treasury_token_account @ SolansError::InvalidTreasury,
        token::token_program = token_program,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(constraint = payment_mint.key() == config.payment_mint @ SolansError::InvalidMint)]
    pub payment_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterName>,
    name: String,
    tld: String,
    name_hash: [u8; 32],
    years: u16,
) -> Result<()> {
    validate_name(&name)?;
    validate_tld(&tld)?;
    require!(
        compute_name_hash(&name, &tld) == name_hash,
        SolansError::NameMismatch
    );

    let config = &ctx.accounts.config;
    validate_years(years, config.min_years, config.max_years)?;
    let amount = config
        .price_for_len(name.len())
        .checked_mul(years as u64)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;

    charge_fee(
        &ctx.accounts.token_program,
        &ctx.accounts.payer_token_account,
        &ctx.accounts.treasury_token_account,
        &ctx.accounts.payment_mint,
        &ctx.accounts.payer,
        amount,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let expires_at = now
        .checked_add(years_to_secs(years)?)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;

    let nr = &mut ctx.accounts.name_record;
    nr.owner = ctx.accounts.owner.key();
    nr.controller = None;
    nr.name_hash = name_hash;
    nr.tld = tld;
    nr.registered_at = now;
    nr.expires_at = expires_at;
    nr.records = Vec::new();
    nr.resolver = None;
    nr.hosting_ref = None;
    nr.transfer_locked = false;
    nr.reverse_set = false;
    nr.nft_mint = None;
    nr.parent = None;
    nr.parent_registered_at = 0;
    nr.depth = 0;
    nr.bump = ctx.bumps.name_record;
    Ok(())
}
