use crate::constants::ACC_SCALE;
use crate::error::SolansError;
use anchor_lang::prelude::*;

/// Global `$SOLANS` staking pool (singleton PDA, seeds = [b"stake_pool"]).
///
/// Stakers deposit `$SOLANS` into `stake_vault` and earn the protocol's staker
/// fee share (§8.2, 25%), which accumulates in `reward_vault` (the payment mint).
/// Rewards are distributed pro-rata by stake weight via the MasterChef
/// accumulated-reward-per-share scheme (`acc_reward_per_share` scaled by
/// `ACC_SCALE`). New deposits into `reward_vault` are detected by diffing its
/// balance against `last_reward_balance` on each operation.
#[account]
#[derive(InitSpace)]
pub struct StakePool {
    /// The staked token (`$SOLANS`).
    pub solans_mint: Pubkey,
    /// Pool-owned vault holding staked `$SOLANS`.
    pub stake_vault: Pubkey,
    /// Pool-owned vault accumulating reward tokens (payment mint); = Config.staking_vault.
    pub reward_vault: Pubkey,
    /// Total `$SOLANS` currently staked.
    pub total_staked: u64,
    /// Accumulated reward per staked token, scaled by `ACC_SCALE`.
    pub acc_reward_per_share: u128,
    /// `reward_vault` balance as of the last sync (to detect new deposits).
    pub last_reward_balance: u64,
    /// Canonical PDA bump.
    pub bump: u8,
}

/// A staker's position (PDA, seeds = [b"stake", owner]).
#[account]
#[derive(InitSpace)]
pub struct StakeAccount {
    pub owner: Pubkey,
    /// `$SOLANS` staked by this account.
    pub amount: u64,
    /// `amount * acc_reward_per_share / ACC_SCALE` as of the last settle; the
    /// baseline subtracted from accrued rewards to get the pending amount.
    pub reward_debt: u128,
    pub bump: u8,
}

impl StakePool {
    /// Credit new `reward_vault` deposits into `acc_reward_per_share`, then move
    /// the watermark. Rewards that arrive while nothing is staked are not
    /// retro-distributed (the watermark still advances past them).
    pub fn sync(&mut self, reward_vault_amount: u64) -> Result<()> {
        if self.total_staked > 0 {
            let delta = reward_vault_amount.saturating_sub(self.last_reward_balance);
            if delta > 0 {
                let add = (delta as u128)
                    .checked_mul(ACC_SCALE)
                    .and_then(|v| v.checked_div(self.total_staked as u128))
                    .ok_or_else(|| error!(SolansError::MathOverflow))?;
                self.acc_reward_per_share = self
                    .acc_reward_per_share
                    .checked_add(add)
                    .ok_or_else(|| error!(SolansError::MathOverflow))?;
            }
        }
        self.last_reward_balance = reward_vault_amount;
        Ok(())
    }

    /// Total accrued reward for `amount` staked at the current per-share value.
    pub fn accrued(&self, amount: u64) -> Result<u128> {
        (amount as u128)
            .checked_mul(self.acc_reward_per_share)
            .and_then(|v| v.checked_div(ACC_SCALE))
            .ok_or_else(|| error!(SolansError::MathOverflow))
    }

    /// The pending (unclaimed) reward for a stake position, in payment-mint units.
    pub fn pending(&self, stake: &StakeAccount) -> Result<u64> {
        Ok(self.accrued(stake.amount)?.saturating_sub(stake.reward_debt) as u64)
    }
}
