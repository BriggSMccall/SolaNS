use crate::constants::*;
use crate::error::SolansError;
use crate::events::AuctionCancelled;
use crate::state::{Auction, NameRecord};
use crate::utils::close_token_account;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

/// Cancel an auction before any bid (seller only). Unfreezes the name and closes
/// the empty vault + auction (rent → seller). Once a bid lands, the auction must
/// run to settlement.
#[derive(Accounts)]
pub struct CancelAuction<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

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
        has_one = seller @ SolansError::NotSeller,
        seeds = [AUCTION_SEED, auction.name_hash.as_ref()],
        bump = auction.bump,
    )]
    pub auction: Box<Account<'info, Auction>>,

    #[account(
        mut,
        address = auction.bid_vault @ SolansError::InvalidTreasury,
        token::token_program = token_program,
    )]
    pub bid_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<CancelAuction>) -> Result<()> {
    require!(
        ctx.accounts.auction.highest_bidder.is_none(),
        SolansError::AuctionHasBids
    );

    let name_hash = ctx.accounts.auction.name_hash;
    let bump = ctx.accounts.auction.bump;
    let seeds: &[&[&[u8]]] = &[&[AUCTION_SEED, name_hash.as_ref(), core::slice::from_ref(&bump)]];

    ctx.accounts.name_record.listed = false;
    close_token_account(
        &ctx.accounts.token_program,
        &ctx.accounts.bid_vault,
        &ctx.accounts.seller.to_account_info(),
        &ctx.accounts.auction.to_account_info(),
        seeds,
    )?;

    emit!(AuctionCancelled { name_hash, seller: ctx.accounts.seller.key() });
    Ok(())
}
