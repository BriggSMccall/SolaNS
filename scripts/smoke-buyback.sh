#!/usr/bin/env bash
#
# Localnet end-to-end smoke for §8.1 pay-in-$SOLANS + buyback-burn (M5c): boot a
# validator with SOLANS preloaded, init-config, create the $SOLANS mint, set up
# the Config-owned burn vault + rate/discount, register paying in $SOLANS (burned
# at a discount), seed the burn vault with a USDC registration, then run the
# permissionless buyback (burn $SOLANS, drain the vault).
#
# Preloading at genesis (`--bpf-program`) sidesteps the devnet SBPFv3 deploy gate.
# Prereqs: solana CLI 3.1.x, spl-token, pnpm, a prior `NO_DNA=1 anchor build`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SOLANS_ID="7pVCKp81EHJi2DbUtUXAkk2b3VtrUZwj2hWDakXY2dMf"
KEYPAIR="$HOME/.config/solana/id.json"
LEDGER="$(mktemp -d)"
CLI=(pnpm --filter solans-cli exec tsx src/index.ts --cluster localnet --keypair "$KEYPAIR")

[[ -f target/deploy/solans.so ]] || { echo "build first: NO_DNA=1 anchor build"; exit 1; }

echo "==> Booting validator (SOLANS preloaded)"
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --bpf-program "$SOLANS_ID" target/deploy/solans.so &
VALIDATOR_PID=$!
trap 'kill "$VALIDATOR_PID" 2>/dev/null || true; rm -rf "$LEDGER"' EXIT

solana config set --url localhost --keypair "$KEYPAIR" >/dev/null
echo "    waiting for RPC..."
for _ in $(seq 1 60); do solana cluster-version >/dev/null 2>&1 && break; sleep 1; done
solana cluster-version >/dev/null 2>&1 || { echo "validator did not come up"; exit 1; }
solana airdrop 100 >/dev/null

mk_vault() { local kp; kp="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$kp" >/dev/null 2>&1; spl-token create-account "$1" "$kp" >/dev/null 2>&1; solana address -k "$kp"; }

echo "==> Payment mint + funded payer ATA + treasury/burn vaults"
MINTKP="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$MINTKP" >/dev/null
MINT="$(solana address -k "$MINTKP")"
spl-token create-token "$MINTKP" --decimals 6 >/dev/null
spl-token create-account "$MINT" >/dev/null
spl-token mint "$MINT" 1000 >/dev/null
TREASURY="$(mk_vault "$MINT")"; STAKING="$(mk_vault "$MINT")"; BURN="$(mk_vault "$MINT")"

echo "==> init-config (5+ price = 1 token; §8.2 5% -> burn vault)"
# Distinct treasury / staking / burn vaults so the USDC register's mutable token
# accounts don't collide (ConstraintDuplicateMutableAccount).
"${CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY" --staking-vault "$STAKING" --burn-vault "$BURN" --price5 1000000

echo "==> Create the \$SOLANS mint + fund the payer"
SOLANSKP="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$SOLANSKP" >/dev/null
SOLANS_MINT="$(solana address -k "$SOLANSKP")"
spl-token create-token "$SOLANSKP" --decimals 6 >/dev/null
spl-token create-account "$SOLANS_MINT" >/dev/null
spl-token mint "$SOLANS_MINT" 10 >/dev/null   # 10 $SOLANS

echo "==> burn-init (Config-owned burn vault) + solans-params (1:1 rate, 25% discount)"
"${CLI[@]}" burn-init "$SOLANS_MINT"
"${CLI[@]}" solans-params --rate 1000000 --discount-bps 2500

echo "==> register alpha --pay-solans (burns 0.75 \$SOLANS at the discount)"
SUPPLY_BEFORE="$(spl-token supply "$SOLANS_MINT")"
"${CLI[@]}" register alpha --pay-solans
SUPPLY_AFTER_PAYIN="$(spl-token supply "$SOLANS_MINT")"
echo "    \$SOLANS supply: $SUPPLY_BEFORE -> $SUPPLY_AFTER_PAYIN (0.75 burned)"

echo "==> register beta (USDC) to seed the burn vault with 5% = 0.05 token"
"${CLI[@]}" register beta

echo "==> buyback 50000 (keeper burns 0.05 \$SOLANS, drains the vault)"
USDC_BEFORE="$(spl-token balance "$MINT")"
"${CLI[@]}" buyback 50000
USDC_AFTER="$(spl-token balance "$MINT")"
SUPPLY_FINAL="$(spl-token supply "$SOLANS_MINT")"
echo "    keeper USDC: $USDC_BEFORE -> $USDC_AFTER (reimbursed 0.05)"
echo "    \$SOLANS supply now: $SUPPLY_FINAL (another 0.05 burned)"

echo
echo "✅ Buyback smoke complete: pay-in-\$SOLANS (burn) + permissionless buyback (burn)"
