use crate::constants::*;
use crate::error::SolansError;
use crate::events::BidPlaced;
use crate::state::Auction;
use crate::utils::{transfer_tokens, transfer_tokens_signed};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Place a `$SOLANS` bid on a live auction. Outbidding refunds the previous bidder
/// from the vault (auction-PDA-signed) and re-escrows the new, higher bid. A bid in
/// the final `AUCTION_EXTENSION_SECONDS` extends `end_time` (anti-snipe).
#[derive(Accounts)]
pub struct Bid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.name_hash.as_ref()],
        bump = auction.bump,
    )]
    pub auction: Box<Account<'info, Auction>>,

    /// Bidder's `$SOLANS` account; the bid is pulled from here.
    #[account(
        mut,
        token::mint = solans_mint,
        token::authority = bidder,
        token::token_program = token_program,
    )]
    pub bidder_solans_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The current highest bidder's `$SOLANS` account; required when there is a
    /// standing bid so the outbid refund lands. Must belong to `highest_bidder`.
    #[account(
        mut,
        token::mint = solans_mint,
        token::token_program = token_program,
        constraint = auction.highest_bidder == Some(prev_bidder_solans_account.owner) @ SolansError::WrongRefundAccount,
    )]
    pub prev_bidder_solans_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// Auction-owned escrow; pinned to `auction.bid_vault`, which fixes `solans_mint`.
    #[account(
        mut,
        address = auction.bid_vault @ SolansError::InvalidTreasury,
        token::mint = solans_mint,
        token::token_program = token_program,
    )]
    pub bid_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mint::token_program = token_program)]
    pub solans_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Bid>, amount: u64) -> Result<()> {
    let auction = &ctx.accounts.auction;
    let now = Clock::get()?.unix_timestamp;
    require!(now < auction.end_time, SolansError::AuctionEnded);
    require!(ctx.accounts.bidder.key() != auction.seller, SolansError::SelfBid);

    // First bid must clear the reserve; later bids must clear highest + increment.
    let min_required = match auction.highest_bidder {
        Some(_) => auction
            .highest_bid
            .checked_add(auction.min_increment)
            .ok_or_else(|| error!(SolansError::MathOverflow))?,
        None => auction.reserve_price,
    };
    require!(amount > 0 && amount >= min_required, SolansError::BidTooLow);

    let name_hash = auction.name_hash;
    let bump = auction.bump;
    let seeds: &[&[&[u8]]] = &[&[AUCTION_SEED, name_hash.as_ref(), core::slice::from_ref(&bump)]];

    // Refund the previous bidder (the vault holds exactly their bid).
    if auction.highest_bidder.is_some() {
        let prev = ctx
            .accounts
            .prev_bidder_solans_account
            .as_deref()
            .ok_or_else(|| error!(SolansError::WrongRefundAccount))?;
        transfer_tokens_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.bid_vault,
            prev,
            &ctx.accounts.solans_mint,
            &ctx.accounts.auction.to_account_info(),
            seeds,
            auction.highest_bid,
        )?;
    }

    // Escrow the new bid (bidder signs their own account).
    transfer_tokens(
        &ctx.accounts.token_program,
        &ctx.accounts.bidder_solans_account,
        &ctx.accounts.bid_vault,
        &ctx.accounts.solans_mint,
        &ctx.accounts.bidder,
        amount,
    )?;

    let auction = &mut ctx.accounts.auction;
    auction.highest_bidder = Some(ctx.accounts.bidder.key());
    auction.highest_bid = amount;

    // Anti-snipe: a bid in the final window pushes the close out.
    let min_end = now
        .checked_add(AUCTION_EXTENSION_SECONDS)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    if auction.end_time < min_end {
        auction.end_time = min_end;
    }

    emit!(BidPlaced {
        name_hash,
        bidder: ctx.accounts.bidder.key(),
        amount,
        end_time: auction.end_time,
    });
    Ok(())
}
