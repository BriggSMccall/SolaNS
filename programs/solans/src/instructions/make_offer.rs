use crate::constants::*;
use crate::error::SolansError;
use crate::events::OfferMade;
use crate::state::{NameRecord, Offer};
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

/// Make a standing SOL bid on a name. Anyone may bid on any registered name; the
/// bid escrows `amount` lamports in the Offer PDA until the owner accepts/rejects
/// or the bidder cancels. One offer per (name, buyer).
#[derive(Accounts)]
pub struct MakeOffer<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        seeds = [NAME_SEED, name_record.name_hash.as_ref()],
        bump = name_record.bump,
    )]
    pub name_record: Account<'info, NameRecord>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Offer::INIT_SPACE,
        seeds = [OFFER_SEED, name_record.name_hash.as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub offer: Account<'info, Offer>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MakeOffer>, amount: u64, duration_seconds: i64) -> Result<()> {
    require!(duration_seconds > 0, SolansError::OfferExpired);

    let now = Clock::get()?.unix_timestamp;
    let expires_at = now
        .checked_add(duration_seconds)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    let name_hash = ctx.accounts.name_record.name_hash;
    let buyer = ctx.accounts.buyer.key();

    let offer = &mut ctx.accounts.offer;
    offer.buyer = buyer;
    offer.name_hash = name_hash;
    offer.amount = amount;
    offer.expires_at = expires_at;
    offer.bump = ctx.bumps.offer;

    // Escrow the bid: move `amount` lamports into the Offer PDA (buyer signs).
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.offer.to_account_info(),
            },
        ),
        amount,
    )?;

    emit!(OfferMade { name_hash, buyer, amount, expires_at });
    Ok(())
}
