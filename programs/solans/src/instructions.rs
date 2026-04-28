// The intentional `handler` glob-reexport collisions are benign (see below).
#![allow(ambiguous_glob_reexports)]

pub mod accept_offer;
pub mod bid;
pub mod burn_name;
pub mod buy_name;
pub mod buyback_burn;
pub mod cancel_auction;
pub mod cancel_listing;
pub mod cancel_offer;
pub mod claim_expired;
pub mod claim_rewards;
pub mod init_burn_pool;
pub mod init_config;
pub mod init_stake_pool;
pub mod list_name;
pub mod lock_transfer;
pub mod make_offer;
pub mod stake;
pub mod unstake;
pub mod redeem_name;
pub mod register_name;
pub mod register_with_solans;
pub mod renew_name;
pub mod renew_with_solans;
pub mod resolve;
pub mod revoke_subdomain;
pub mod set_solans_params;
pub mod settle_auction;
pub mod start_auction;
pub mod transfer_admin;
pub mod set_controller;
pub mod set_hosting;
pub mod set_resolver;
pub mod set_reverse;
pub mod tokenize_name;
pub mod transfer_name;
pub mod update_config;
pub mod update_listing;
pub mod update_record;
pub mod wrap_subdomain;

// Glob re-exports (matches the Anchor convention) so the `#[program]` macro can
// resolve each instruction's generated `__client_accounts_*` modules at the
// crate root. The colliding `handler` symbols are never referenced via the glob
// (handlers are called by full path: `instructions::<mod>::handler`).
pub use accept_offer::*;
pub use bid::*;
pub use burn_name::*;
pub use buy_name::*;
pub use buyback_burn::*;
pub use cancel_auction::*;
pub use cancel_listing::*;
pub use cancel_offer::*;
pub use claim_expired::*;
pub use claim_rewards::*;
pub use init_burn_pool::*;
pub use init_config::*;
pub use init_stake_pool::*;
pub use list_name::*;
pub use lock_transfer::*;
pub use make_offer::*;
pub use stake::*;
pub use unstake::*;
pub use redeem_name::*;
pub use register_name::*;
pub use register_with_solans::*;
pub use renew_name::*;
pub use renew_with_solans::*;
pub use resolve::*;
pub use revoke_subdomain::*;
pub use set_solans_params::*;
pub use settle_auction::*;
pub use start_auction::*;
pub use transfer_admin::*;
pub use set_controller::*;
pub use set_hosting::*;
pub use set_resolver::*;
pub use set_reverse::*;
pub use tokenize_name::*;
pub use transfer_name::*;
pub use update_config::*;
pub use update_listing::*;
pub use update_record::*;
pub use wrap_subdomain::*;
