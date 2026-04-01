use crate::constants::*;
use crate::error::SolansError;
use crate::events::NameSold;
use crate::state::{Config, Listing, NameRecord};
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

/// Buy a listed name: pay the seller + protocol fee in native SOL and take
/// ownership atomically. `expected_price` guards against a front-run reprice.
#[derive(Accounts)]
pub struct BuyName<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: the seller; receives SOL + the listing rent. Must equal `listing.seller`.
    #[account(mut, address = listing.seller @ SolansError::NotSeller)]
    pub seller: SystemAccount<'info>,

    /// CHECK: receives the SOL fee. Must equal `config.sol_treasury`.
    #[account(mut, address = config.sol_treasury @ SolansError::InvalidTreasury)]
    pub sol_treasury: SystemAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

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

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<BuyName>, expected_price: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let listing = &ctx.accounts.listing;
    let nr = &ctx.accounts.name_record;

    require!(nr.listed, SolansError::NotListed);
    // A stale listing (the seller transferred or the name was claimed) is void.
    require!(nr.owner == listing.seller, SolansError::NotSeller);
    require!(
        ctx.accounts.buyer.key() != listing.seller,
        SolansError::SelfPurchase
    );
    require!(now <= listing.expires_at, SolansError::ListingExpired);
    require!(expected_price == listing.price, SolansError::PriceMismatch);

    let price = listing.price;
    let fee = (price as u128)
        .checked_mul(ctx.accounts.config.marketplace_fee_bps as u128)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR as u128))
        .ok_or_else(|| error!(SolansError::MathOverflow))? as u64;
    let to_seller = price
        .checked_sub(fee)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;

    let name_hash = nr.name_hash;
    let seller = listing.seller;
    let buyer = ctx.accounts.buyer.key();
    // `CpiContext::new` takes the program id (Pubkey) in Anchor 1.0.2; the System
    // program account is resolved from the loaded accounts.
    let sys_id = ctx.accounts.system_program.key();

    // Pay the seller, then the protocol fee — native SOL, buyer signs (no escrow).
    if to_seller > 0 {
        transfer(
            CpiContext::new(
                sys_id,
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
            ),
            to_seller,
        )?;
    }
    if fee > 0 {
        transfer(
            CpiContext::new(
                sys_id,
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.sol_treasury.to_account_info(),
                },
            ),
            fee,
        )?;
    }

    let nr = &mut ctx.accounts.name_record;
    nr.owner = buyer;
    nr.controller = None;
    nr.reverse_set = false;
    nr.listed = false;

    emit!(NameSold { name_hash, seller, buyer, price, fee });
    Ok(())
}
