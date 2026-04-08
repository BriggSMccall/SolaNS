use crate::constants::*;
use crate::error::SolansError;
use crate::events::OfferCancelled;
use crate::state::{NameRecord, Offer};
use anchor_lang::prelude::*;

/// Close an offer and refund the bidder (escrow + rent). Callable by the bidder
/// (cancel), by the name owner (reject — pass `name_record`), or by anyone once
/// the offer has expired (cleanup). `name_record` is optional so a bidder can
/// always reclaim even if the name was burned.
#[derive(Accounts)]
pub struct CancelOffer<'info> {
    pub canceller: Signer<'info>,

    /// CHECK: the bidder; receives the refund. Must equal `offer.buyer`.
    #[account(mut, address = offer.buyer @ SolansError::NotOfferer)]
    pub buyer: SystemAccount<'info>,

    #[account(
        seeds = [NAME_SEED, name_record.name_hash.as_ref()],
        bump = name_record.bump,
    )]
    pub name_record: Option<Account<'info, NameRecord>>,

    #[account(
        mut,
        close = buyer,
        seeds = [OFFER_SEED, offer.name_hash.as_ref(), offer.buyer.as_ref()],
        bump = offer.bump,
    )]
    pub offer: Account<'info, Offer>,
}

pub fn handler(ctx: Context<CancelOffer>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let offer = &ctx.accounts.offer;
    let canceller = ctx.accounts.canceller.key();

    // The name owner (rejecting) must present the matching name_record.
    let is_owner = ctx
        .accounts
        .name_record
        .as_ref()
        .is_some_and(|nr| nr.name_hash == offer.name_hash && nr.owner == canceller);

    require!(
        canceller == offer.buyer || is_owner || now > offer.expires_at,
        SolansError::NotOfferer
    );

    emit!(OfferCancelled {
        name_hash: offer.name_hash,
        buyer: offer.buyer,
    });
    Ok(())
}
