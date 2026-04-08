use crate::constants::*;
use crate::error::SolansError;
use crate::events::OfferAccepted;
use crate::state::{Config, NameRecord, Offer};
use crate::utils::move_lamports;
use anchor_lang::prelude::*;

/// Accept a standing offer: the name owner takes the escrowed SOL (minus the
/// protocol fee) and the bidder receives the name. Atomic; mirrors `buy_name`.
#[derive(Accounts)]
pub struct AcceptOffer<'info> {
    pub owner: Signer<'info>,

    /// CHECK: the bidder; receives the name + the offer rent. Must equal `offer.buyer`.
    #[account(mut, address = offer.buyer @ SolansError::NotOfferer)]
    pub buyer: SystemAccount<'info>,

    /// CHECK: receives the SOL fee. Must equal `config.sol_treasury`.
    #[account(mut, address = config.sol_treasury @ SolansError::InvalidTreasury)]
    pub sol_treasury: SystemAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        has_one = owner @ SolansError::NotOwner,
        seeds = [NAME_SEED, name_record.name_hash.as_ref()],
        bump = name_record.bump,
        constraint = name_record.name_hash == offer.name_hash @ SolansError::NotOfferer,
    )]
    pub name_record: Account<'info, NameRecord>,

    #[account(
        mut,
        close = buyer,
        seeds = [OFFER_SEED, offer.name_hash.as_ref(), offer.buyer.as_ref()],
        bump = offer.bump,
    )]
    pub offer: Account<'info, Offer>,
}

pub fn handler(ctx: Context<AcceptOffer>) -> Result<()> {
    let nr = &ctx.accounts.name_record;
    require!(nr.nft_mint.is_none(), SolansError::Tokenized); // tokenized -> trade the NFT
    require!(!nr.listed, SolansError::Listed); // cancel the listing first

    let now = Clock::get()?.unix_timestamp;
    let offer = &ctx.accounts.offer;
    require!(now <= offer.expires_at, SolansError::OfferExpired);
    require!(offer.buyer != ctx.accounts.owner.key(), SolansError::SelfPurchase);

    let amount = offer.amount;
    let fee = (amount as u128)
        .checked_mul(ctx.accounts.config.marketplace_fee_bps as u128)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR as u128))
        .ok_or_else(|| error!(SolansError::MathOverflow))? as u64;
    let to_owner = amount
        .checked_sub(fee)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;

    let name_hash = nr.name_hash;
    let buyer = offer.buyer;
    let seller = ctx.accounts.owner.key();

    // Pay out the escrow (the Offer PDA is program-owned, so we debit it
    // directly); Anchor's `close = buyer` then refunds the remaining rent.
    let offer_ai = ctx.accounts.offer.to_account_info();
    move_lamports(&offer_ai, &ctx.accounts.owner.to_account_info(), to_owner)?;
    move_lamports(&offer_ai, &ctx.accounts.sol_treasury.to_account_info(), fee)?;

    let nr = &mut ctx.accounts.name_record;
    nr.owner = buyer;
    nr.controller = None;
    nr.reverse_set = false;

    emit!(OfferAccepted { name_hash, seller, buyer, amount, fee });
    Ok(())
}
