# SOLANS — Governance & Launch Runbook

This document describes who controls the deployed SOLANS program, exactly what
that authority can and cannot do, the authority-handoff path from a single
deployer key to a DAO, and the pre-mainnet launch checklist. It is the target of
the references in [`README.md`](../README.md) and [`SECURITY.md`](../SECURITY.md).

- **Mainnet program id:** `AiDB9oh4jMKuGnx4nEseMgW7qpMnswygx6wpFKJbXKfb`
- **Config PDA:** `2PJ8Wu2WdTmHUqc68Z8EDqHHXpQnJmaDogoN4wM2tjgD` (seeds `[b"config"]`)

## 1. Two distinct authorities

Solana separates two powers that this document treats separately:

1. **Upgrade authority** — the key held by the BPF loader that can deploy new
   program bytecode (or set the program immutable). This is a Solana-native
   authority, not a program account field.
2. **Config admin** (`Config.admin`) — an in-program authority that can tune
   economic parameters via `update_config` / `set_solans_params` and rotate
   itself via `transfer_admin`.

These are set and transferred independently. A safe launch moves **both** away
from the deployer's hot key.

## 2. What the Config admin can and cannot do

The admin's surface is deliberately narrow. It can call:

| Instruction | Effect |
|---|---|
| `update_config` | Adjust price tiers, grace period, min/max years, SOL marketplace-fee treasury (`sol_treasury`), and the §8.2 fee-split bps (staking / referral / burn; each capped so the sum stays `< 10_000`, `MAX_FEE_BPS = 10%`). |
| `set_solans_params` | Set the §8.1 `$SOLANS` pay-in rate and discount bps. |
| `transfer_admin` | Rotate `Config.admin` to a new key (e.g. multisig → DAO). |
| `init_stake_pool` / `init_burn_pool` | One-time setup of the staking and buyback vaults + `$SOLANS` mint. |

The admin **cannot**:

- Touch or transfer any user's name (`NameRecord`) — ownership only moves through
  documented user instructions (transfer / trade / claim-expired).
- Move escrowed funds — listings, offers, and auctions are non-custodial; the
  program only releases escrow along the documented swap path.
- Change immutable custody fields after `init_config` / `init_burn_pool`:
  `payment_mint`, `treasury_token_account`, `staking_vault`, `burn_vault`, and
  `solans_mint` are **not** parameters of `update_config` and cannot be rotated.

This means a compromised admin key can distort economics (fees, prices, the
`$SOLANS` rate) but cannot steal names or custodied funds.

## 3. Authority-handoff path

The intended progression, from launch to decentralized control:

1. **Deployer hot key** (bootstrap only) — deploys the program, runs
   `init_config`, `init_stake_pool`, `init_burn_pool`, and the devnet rehearsal.
   Never the long-term authority.
2. **3/5 Squads multisig** — both the upgrade authority and `Config.admin` are
   transferred here first. Signers should be distinct, geographically separate,
   hardware-backed keys.
   - Upgrade authority: `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_VAULT>`
   - Config admin: `transfer_admin(<SQUADS_VAULT>)`
3. **Realms DAO with a 7-day timelock** — once the token/community is live, both
   authorities move to a Realms governance whose proposals execute only after a
   7-day timelock, giving users time to react to any upgrade or parameter change.

At each step, verify the on-chain authority actually changed (read the program
account's upgrade authority and `Config.admin`) before discarding the prior key.

## 4. Operational monitoring

- **`$SOLANS` rate (no oracle).** `buyback_burn` reimburses keepers from the burn
  vault at `Config.solans_rate` (see [`SECURITY.md`](../SECURITY.md) "Known
  limitations"). The admin/DAO must keep the rate at or above market, or the burn
  vault can be drained at a discount. Monitor the rate vs. market price and the
  burn-vault balance; alert on divergence.
- **Metrics.** The resolver and indexer expose `GET /metrics` and the keeper
  serves `/metrics` on `KEEPER_METRICS_PORT`; scrape with Prometheus and alert
  (Grafana + PagerDuty) on error rates, keeper `renewal-failed` events, and
  vault-balance thresholds.

## 5. Pre-mainnet launch checklist

- [ ] **External audit** of `programs/solans` completed and findings resolved.
- [ ] **Reproducible build** verified: `bash scripts/verify-build.sh` prints the
      sha256 of `solans.so`; `solana-verify verify-from-repo` matches the
      deployed bytecode.
- [ ] **Program-id rotation** done for the real mainnet key via
      `scripts/rotate-program-id.sh` (build with `anchor build --ignore-keys`; do
      **not** commit the mainnet program secret). Then grep the tree — clients,
      `.env.example`, services, `Anchor.toml` — for the old id to confirm no stale
      copies remain.
- [ ] **Clients regenerated** from the post-rotation IDL (`pnpm generate`) and the
      committed `clients/ts/src/generated` diff is clean in CI.
- [ ] **Devnet rehearsal** of the full user journey with the mainnet config shape:
      init → register → trade (list/buy, offer/accept, auction) → stake/claim →
      buyback → auto-renew, with before/after account-state checks.
- [ ] **Upgrade authority** transferred to the Squads multisig (§3).
- [ ] **Config admin** transferred to the Squads multisig (`transfer_admin`).
- [ ] **Monitoring live** (§4) before opening registration to users.
- [ ] **Config sanity read-back**: prices, treasury, fee-split bps, `$SOLANS`
      rate/discount, grace and year bounds all read back as intended on mainnet.
