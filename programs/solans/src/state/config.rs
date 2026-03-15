use anchor_lang::prelude::*;

/// Global registry configuration (singleton PDA, seeds = [b"config"]).
///
/// Prices are denominated in the payment mint's base units (e.g. a 6-decimal
/// USDC-style mint: `$5.00` => `5_000_000`). No price oracle is used.
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Admin authority (may update config; pays for `init`).
    pub admin: Pubkey,
    /// SPL mint used for registration/renewal payment.
    pub payment_mint: Pubkey,
    /// Treasury token account that receives fees.
    pub treasury_token_account: Pubkey,
    /// Price-per-year tiers by name byte-length.
    pub price_1: u64,
    pub price_2: u64,
    pub price_3: u64,
    pub price_4: u64,
    pub price_5plus: u64,
    /// Seconds after `expires_at` before a name can be claimed by anyone.
    pub grace_period_seconds: i64,
    /// Allowed registration term bounds.
    pub min_years: u16,
    pub max_years: u16,
    /// Canonical PDA bump.
    pub bump: u8,
}

impl Config {
    /// Price-per-year for a (validated) name of the given byte-length.
    /// Byte-length equals character-length because names are ASCII.
    pub fn price_for_len(&self, len: usize) -> u64 {
        match len {
            1 => self.price_1,
            2 => self.price_2,
            3 => self.price_3,
            4 => self.price_4,
            _ => self.price_5plus,
        }
    }
}
