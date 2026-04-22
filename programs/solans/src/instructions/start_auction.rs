use crate::constants::*;
use crate::error::SolansError;
use crate::events::AuctionStarted;
use crate::state::{Auction, Config, NameRecord};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Open an English `$SOLANS` auction on a name (§9.1). Non-custodial: the seller
/// keeps `owner`; the name is frozen via `listed = true` until settled/cancelled.
/// Bids escrow into the PDA-owned `bid_vault`. The grace period buffers against
/// `claim_expired` running during a (short) auction, so no expiry guard is needed.
#[derive(Accounts)]
pub struct StartAuction<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        has_one = owner @ SolansError::NotOwner,
        seeds = [NAME_SEED, name_record.name_hash.as_ref()],
        bump = name_record.bump,
    )]
    pub name_record: Box<Account<'info, NameRecord>>,

    #[account(
        init,
        payer = owner,
        space = 8 + Auction::INIT_SPACE,
        seeds = [AUCTION_SEED, name_record.name_hash.as_ref()],
        bump
    )]
    pub auction: Box<Account<'info, Auction>>,

    #[account(
        address = config.solans_mint @ SolansError::InvalidMint,
        mint::token_program = token_program,
    )]
    pub solans_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Auction-owned vault holding the current highest bid (`$SOLANS`).
    #[account(
        init,
        payer = owner,
        associated_token::mint = solans_mint,
        associated_token::authority = auction,
        associated_token::token_program = token_program,
    )]
    pub bid_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<StartAuction>,
    reserve_price: u64,
    min_increment: u64,
    duration_seconds: i64,
) -> Result<()> {
    let nr = &ctx.accounts.name_record;
    require!(ctx.accounts.config.solans_enabled(), SolansError::SolansNotConfigured);
    require!(nr.nft_mint.is_none(), SolansError::Tokenized); // tokenized names trade as NFTs
    require!(nr.parent.is_none(), SolansError::Subdomain); // subdomains follow the parent
    require!(!nr.transfer_locked, SolansError::TransferLocked);
    require!(!nr.listed, SolansError::Listed);
    require!(duration_seconds > 0, SolansError::AuctionEnded);

    let now = Clock::get()?.unix_timestamp;
    let end_time = now
        .checked_add(duration_seconds)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    let name_hash = nr.name_hash;
    let seller = ctx.accounts.owner.key();

    let auction = &mut ctx.accounts.auction;
    auction.seller = seller;
    auction.name_hash = name_hash;
    auction.bid_vault = ctx.accounts.bid_vault.key();
    auction.highest_bidder = None;
    auction.highest_bid = 0;
    auction.reserve_price = reserve_price;
    auction.min_increment = min_increment;
    auction.end_time = end_time;
    auction.bump = ctx.bumps.auction;

    ctx.accounts.name_record.listed = true;

    emit!(AuctionStarted { name_hash, seller, reserve_price, end_time });
    Ok(())
}
