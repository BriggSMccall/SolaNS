use crate::constants::*;
use crate::error::SolansError;
use crate::events::AuctionSettled;
use crate::state::{Auction, Config, NameRecord};
use crate::utils::{burn_tokens_signed, close_token_account, transfer_tokens_signed};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Settle a finished auction — **permissionless** once past `end_time`. With a
/// winner: transfer the name, pay the seller `bid − fee` in `$SOLANS`, and burn the
/// fee (deflationary, §8.1). With no bids: just unfreeze. Always drains + closes the
/// bid vault and the auction (rent → seller).
#[derive(Accounts)]
pub struct SettleAuction<'info> {
    pub settler: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: the seller; receives the payout + the auction/vault rent. Pinned to `auction.seller`.
    #[account(mut, address = auction.seller @ SolansError::NotSeller)]
    pub seller: SystemAccount<'info>,

    /// Seller's `$SOLANS` account; receives the winning bid (minus fee). Required when
    /// there is a winner. `token::authority = seller` (== `auction.seller`) pins the
    /// payout to the real seller — without it, a permissionless settler could pass its
    /// own account and redirect the proceeds (audit H-1).
    #[account(
        mut,
        token::mint = solans_mint,
        token::authority = seller,
        token::token_program = token_program,
    )]
    pub seller_solans_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    #[account(
        mut,
        seeds = [NAME_SEED, name_record.name_hash.as_ref()],
        bump = name_record.bump,
        constraint = name_record.name_hash == auction.name_hash @ SolansError::NameMismatch,
    )]
    pub name_record: Box<Account<'info, NameRecord>>,

    #[account(
        mut,
        close = seller,
        seeds = [AUCTION_SEED, auction.name_hash.as_ref()],
        bump = auction.bump,
    )]
    pub auction: Box<Account<'info, Auction>>,

    #[account(
        mut,
        address = auction.bid_vault @ SolansError::InvalidTreasury,
        token::mint = solans_mint,
        token::token_program = token_program,
    )]
    pub bid_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, mint::token_program = token_program)]
    pub solans_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<SettleAuction>) -> Result<()> {
    let auction = &ctx.accounts.auction;
    let now = Clock::get()?.unix_timestamp;
    require!(now >= auction.end_time, SolansError::AuctionActive);

    let name_hash = auction.name_hash;
    let bump = auction.bump;
    let seller = auction.seller;
    let winner = auction.highest_bidder;
    let amount = auction.highest_bid;
    let seeds: &[&[&[u8]]] = &[&[AUCTION_SEED, name_hash.as_ref(), core::slice::from_ref(&bump)]];

    let mut fee = 0u64;
    if let Some(winner_key) = winner {
        fee = (amount as u128)
            .checked_mul(ctx.accounts.config.marketplace_fee_bps as u128)
            .and_then(|v| v.checked_div(BPS_DENOMINATOR as u128))
            .ok_or_else(|| error!(SolansError::MathOverflow))? as u64;
        let to_seller = amount
            .checked_sub(fee)
            .ok_or_else(|| error!(SolansError::MathOverflow))?;

        let seller_solans = ctx
            .accounts
            .seller_solans_account
            .as_deref()
            .ok_or_else(|| error!(SolansError::InvalidTreasury))?;
        // Pay the seller and burn the fee, both out of the auction-owned vault.
        transfer_tokens_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.bid_vault,
            seller_solans,
            &ctx.accounts.solans_mint,
            &ctx.accounts.auction.to_account_info(),
            seeds,
            to_seller,
        )?;
        burn_tokens_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.solans_mint,
            &ctx.accounts.bid_vault,
            &ctx.accounts.auction.to_account_info(),
            seeds,
            fee,
        )?;

        let nr = &mut ctx.accounts.name_record;
        nr.owner = winner_key;
        nr.controller = None;
        nr.reverse_set = false;
    }

    // Unfreeze regardless of outcome, then close the (now-empty) vault.
    ctx.accounts.name_record.listed = false;
    close_token_account(
        &ctx.accounts.token_program,
        &ctx.accounts.bid_vault,
        &ctx.accounts.seller.to_account_info(),
        &ctx.accounts.auction.to_account_info(),
        seeds,
    )?;

    emit!(AuctionSettled { name_hash, seller, winner, amount, fee });
    Ok(())
}
