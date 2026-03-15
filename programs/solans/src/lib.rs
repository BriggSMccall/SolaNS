pub mod constants;
pub mod error;
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
        grace_period_seconds: i64,
        min_years: u16,
        max_years: u16,
    ) -> Result<()> {
        instructions::init_config::handler(
            ctx,
            price_1,
            price_2,
            price_3,
            price_4,
            price_5plus,
            grace_period_seconds,
            min_years,
            max_years,
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
}
