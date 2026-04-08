pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("7pVCKp81EHJi2DbUtUXAkk2b3VtrUZwj2hWDakXY2dMf");

#[program]
pub mod solans {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn init_config(
        ctx: Context<InitConfig>,
        price_1: u64,
        price_2: u64,
        price_3: u64,
        price_4: u64,
        price_5plus: u64,
        price_numeric: u64,
        grace_period_seconds: i64,
        min_years: u16,
        max_years: u16,
        sol_treasury: Pubkey,
        marketplace_fee_bps: u16,
    ) -> Result<()> {
        instructions::init_config::handler(
            ctx,
            price_1,
            price_2,
            price_3,
            price_4,
            price_5plus,
            price_numeric,
            grace_period_seconds,
            min_years,
            max_years,
            sol_treasury,
            marketplace_fee_bps,
        )
    }

    pub fn register_name(
        ctx: Context<RegisterName>,
        name: String,
        tld: String,
        name_hash: [u8; 32],
        years: u16,
    ) -> Result<()> {
        instructions::register_name::handler(ctx, name, tld, name_hash, years)
    }

    pub fn renew_name(
        ctx: Context<RenewName>,
        name: String,
        tld: String,
        years: u16,
    ) -> Result<()> {
        instructions::renew_name::handler(ctx, name, tld, years)
    }

    pub fn update_record(
        ctx: Context<UpdateRecord>,
        key: String,
        value: Option<String>,
    ) -> Result<()> {
        instructions::update_record::handler(ctx, key, value)
    }

    pub fn set_controller(
        ctx: Context<SetController>,
        controller: Option<Pubkey>,
    ) -> Result<()> {
        instructions::set_controller::handler(ctx, controller)
    }

    pub fn set_resolver(ctx: Context<SetResolver>, resolver: Option<Pubkey>) -> Result<()> {
        instructions::set_resolver::handler(ctx, resolver)
    }

    pub fn set_hosting(ctx: Context<SetHosting>, hosting_ref: Option<String>) -> Result<()> {
        instructions::set_hosting::handler(ctx, hosting_ref)
    }

    pub fn transfer_name(ctx: Context<TransferName>, new_owner: Pubkey) -> Result<()> {
        instructions::transfer_name::handler(ctx, new_owner)
    }

    pub fn lock_transfer(ctx: Context<LockTransfer>, lock: bool) -> Result<()> {
        instructions::lock_transfer::handler(ctx, lock)
    }

    pub fn set_reverse(ctx: Context<SetReverse>, name: String) -> Result<()> {
        instructions::set_reverse::handler(ctx, name)
    }

    pub fn claim_expired(
        ctx: Context<ClaimExpired>,
        name: String,
        tld: String,
        years: u16,
    ) -> Result<()> {
        instructions::claim_expired::handler(ctx, name, tld, years)
    }

    pub fn burn_name(ctx: Context<BurnName>) -> Result<()> {
        instructions::burn_name::handler(ctx)
    }

    pub fn tokenize_name(ctx: Context<TokenizeName>, name: String) -> Result<()> {
        instructions::tokenize_name::handler(ctx, name)
    }

    pub fn redeem_name(ctx: Context<RedeemName>) -> Result<()> {
        instructions::redeem_name::handler(ctx)
    }

    pub fn wrap_subdomain(
        ctx: Context<WrapSubdomain>,
        label: String,
        name_hash: [u8; 32],
    ) -> Result<()> {
        instructions::wrap_subdomain::handler(ctx, label, name_hash)
    }

    pub fn revoke_subdomain(ctx: Context<RevokeSubdomain>) -> Result<()> {
        instructions::revoke_subdomain::handler(ctx)
    }

    pub fn list_name(ctx: Context<ListName>, price: u64, duration_seconds: i64) -> Result<()> {
        instructions::list_name::handler(ctx, price, duration_seconds)
    }

    pub fn update_listing(
        ctx: Context<UpdateListing>,
        price: u64,
        duration_seconds: i64,
    ) -> Result<()> {
        instructions::update_listing::handler(ctx, price, duration_seconds)
    }

    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        instructions::cancel_listing::handler(ctx)
    }

    pub fn buy_name(ctx: Context<BuyName>, expected_price: u64) -> Result<()> {
        instructions::buy_name::handler(ctx, expected_price)
    }

    pub fn make_offer(ctx: Context<MakeOffer>, amount: u64, duration_seconds: i64) -> Result<()> {
        instructions::make_offer::handler(ctx, amount, duration_seconds)
    }

    pub fn accept_offer(ctx: Context<AcceptOffer>) -> Result<()> {
        instructions::accept_offer::handler(ctx)
    }

    pub fn cancel_offer(ctx: Context<CancelOffer>) -> Result<()> {
        instructions::cancel_offer::handler(ctx)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        price_1: u64,
        price_2: u64,
        price_3: u64,
        price_4: u64,
        price_5plus: u64,
        price_numeric: u64,
        grace_period_seconds: i64,
        min_years: u16,
        max_years: u16,
        sol_treasury: Pubkey,
        marketplace_fee_bps: u16,
    ) -> Result<()> {
        instructions::update_config::handler(
            ctx,
            price_1,
            price_2,
            price_3,
            price_4,
            price_5plus,
            price_numeric,
            grace_period_seconds,
            min_years,
            max_years,
            sol_treasury,
            marketplace_fee_bps,
        )
    }
}
