use crate::constants::*;
use crate::error::SolansError;
use crate::events::ListingCancelled;
use crate::state::{Listing, NameRecord};
use anchor_lang::prelude::*;

/// Cancel a listing and unfreeze the name. The seller may cancel anytime; anyone
/// may clean up a listing once it has expired (so a name is never stuck frozen).
/// The listing rent is returned to the seller.
#[derive(Accounts)]
pub struct CancelListing<'info> {
    pub canceller: Signer<'info>,

    /// CHECK: receives the listing rent; constrained to `listing.seller`.
    #[account(mut, address = listing.seller @ SolansError::NotSeller)]
    pub seller: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [NAME_SEED, name_record.name_hash.as_ref()],
        bump = name_record.bump,
        constraint = name_record.name_hash == listing.name_hash @ SolansError::NotListed,
    )]
    pub name_record: Account<'info, NameRecord>,

    #[account(
        mut,
        seeds = [LISTING_SEED, listing.name_hash.as_ref()],
        bump = listing.bump,
        close = seller,
    )]
    pub listing: Account<'info, Listing>,
}

pub fn handler(ctx: Context<CancelListing>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let listing = &ctx.accounts.listing;
    require!(
        ctx.accounts.canceller.key() == listing.seller || now > listing.expires_at,
        SolansError::NotSeller
    );

    let name_hash = listing.name_hash;
    let seller = listing.seller;
    ctx.accounts.name_record.listed = false;

    emit!(ListingCancelled { name_hash, seller });
    Ok(())
}
