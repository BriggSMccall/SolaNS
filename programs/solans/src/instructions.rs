// The intentional `handler` glob-reexport collisions are benign (see below).
#![allow(ambiguous_glob_reexports)]

pub mod burn_name;
pub mod claim_expired;
pub mod init_config;
pub mod lock_transfer;
pub mod redeem_name;
pub mod register_name;
pub mod renew_name;
pub mod set_controller;
pub mod set_hosting;
pub mod set_resolver;
pub mod set_reverse;
pub mod tokenize_name;
pub mod transfer_name;
pub mod update_config;
pub mod update_record;

// Glob re-exports (matches the Anchor convention) so the `#[program]` macro can
// resolve each instruction's generated `__client_accounts_*` modules at the
// crate root. The colliding `handler` symbols are never referenced via the glob
// (handlers are called by full path: `instructions::<mod>::handler`).
pub use burn_name::*;
pub use claim_expired::*;
pub use init_config::*;
pub use lock_transfer::*;
pub use redeem_name::*;
pub use register_name::*;
pub use renew_name::*;
pub use set_controller::*;
pub use set_hosting::*;
pub use set_resolver::*;
pub use set_reverse::*;
pub use tokenize_name::*;
pub use transfer_name::*;
pub use update_config::*;
pub use update_record::*;
