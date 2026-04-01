use crate::constants::*;
use crate::error::SolansError;
use crate::events::NameListed;
use crate::state::{Listing, NameRecord};
use anchor_lang::prelude::*;

/// List a name for sale at a fixed price (lamports). Non-custodial: the seller
/// keeps `owner`; the name is frozen via `listed = true` until bought/cancelled.
#[derive(Accounts)]
pub struct ListName<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ SolansError::NotOwner,
        seeds = [NAME_SEED, name_record.name_hash.as_ref()],
        bump = name_record.bump,
    )]
    pub name_record: Account<'info, NameRecord>,

    #[account(
        init,
        payer = owner,
        space = 8 + Listing::INIT_SPACE,
        seeds = [LISTING_SEED, name_record.name_hash.as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ListName>, price: u64, duration_seconds: i64) -> Result<()> {
    let nr = &ctx.accounts.name_record;
    require!(nr.nft_mint.is_none(), SolansError::Tokenized); // tokenized names trade as NFTs
    require!(!nr.transfer_locked, SolansError::TransferLocked);
    require!(!nr.listed, SolansError::Listed);
    require!(duration_seconds > 0, SolansError::ListingExpired);

    let name_hash = nr.name_hash;
    let now = Clock::get()?.unix_timestamp;
    let expires_at = now
        .checked_add(duration_seconds)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    let seller = ctx.accounts.owner.key();

    let listing = &mut ctx.accounts.listing;
    listing.seller = seller;
    listing.name_hash = name_hash;
    listing.price = price;
    listing.expires_at = expires_at;
    listing.bump = ctx.bumps.listing;

    ctx.accounts.name_record.listed = true;

    emit!(NameListed { name_hash, seller, price, expires_at });
    Ok(())
}
