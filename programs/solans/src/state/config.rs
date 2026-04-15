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
    /// Per-year price for a premium numeric name (all digits, ≤ 4 chars).
    pub price_numeric: u64,
    /// Seconds after `expires_at` before a name can be claimed by anyone.
    pub grace_period_seconds: i64,
    /// Allowed registration term bounds.
    pub min_years: u16,
    pub max_years: u16,
    /// Wallet that receives native-SOL marketplace fees.
    pub sol_treasury: Pubkey,
    /// Marketplace fee in basis points (e.g. 200 = 2%), capped at `MAX_FEE_BPS`.
    pub marketplace_fee_bps: u16,
    /// Token account (payment mint) accumulating the `$SOLANS` stakers' fee share.
    pub staking_vault: Pubkey,
    /// Token account (payment mint) accumulating the burn (buyback) fee share.
    pub burn_vault: Pubkey,
    /// Protocol fee-split (§8.2) in basis points. Treasury gets the remainder.
    pub staking_fee_bps: u16,
    pub referral_fee_bps: u16,
    pub burn_fee_bps: u16,
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

    /// Price-per-year for a validated label, applying the numeric premium: an
    /// all-digit label of length ≤ 4 (spec §9.2 "Numeric 1–4 digits") costs
    /// `price_numeric`; everything else uses the length tier.
    pub fn price_for_label(&self, label: &str) -> u64 {
        let b = label.as_bytes();
        if b.len() <= 4 && b.iter().all(|c| c.is_ascii_digit()) {
            self.price_numeric
        } else {
            self.price_for_len(b.len())
        }
    }

    /// Split a fee into (treasury, staking, referral, burn) shares per §8.2.
    /// Each non-treasury share floors `amount * bps / 10_000`; treasury takes the
    /// remainder so the four shares always sum to exactly `amount` (no dust lost).
    pub fn fee_split(&self, amount: u64) -> (u64, u64, u64, u64) {
        // `amount`(u64) * `bps`(≤10_000) fits in u128, and `* bps / 10_000` ≤ amount,
        // so saturating ops never actually saturate — they're just a safe floor.
        let share = |bps: u16| -> u64 {
            ((amount as u128).saturating_mul(bps as u128)
                / (crate::constants::BPS_DENOMINATOR as u128)) as u64
        };
        let staking = share(self.staking_fee_bps);
        let referral = share(self.referral_fee_bps);
        let burn = share(self.burn_fee_bps);
        // bps sum < 10_000 (validated at config time) ⇒ the three shares < amount.
        let treasury = amount
            .saturating_sub(staking)
            .saturating_sub(referral)
            .saturating_sub(burn);
        (treasury, staking, referral, burn)
    }
}
