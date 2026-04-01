use crate::constants::*;
use crate::error::SolansError;
use crate::state::Listing;
use anchor_lang::prelude::*;

/// Reprice / re-extend an active listing. Seller only.
#[derive(Accounts)]
pub struct UpdateListing<'info> {
    pub seller: Signer<'info>,

    #[account(
        mut,
        has_one = seller @ SolansError::NotSeller,
        seeds = [LISTING_SEED, listing.name_hash.as_ref()],
        bump = listing.bump,
    )]
    pub listing: Account<'info, Listing>,
}

pub fn handler(ctx: Context<UpdateListing>, price: u64, duration_seconds: i64) -> Result<()> {
    require!(duration_seconds > 0, SolansError::ListingExpired);
    let now = Clock::get()?.unix_timestamp;
    let listing = &mut ctx.accounts.listing;
    listing.price = price;
    listing.expires_at = now
        .checked_add(duration_seconds)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    Ok(())
}
