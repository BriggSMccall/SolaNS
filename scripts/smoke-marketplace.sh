#!/usr/bin/env bash
#
# Localnet end-to-end smoke for the marketplace (M4): boot a validator with the
# SOLANS program preloaded, init-config (with a SOL fee treasury), then exercise
# register -> list -> buy (from a second funded wallet) -> confirm the SOL moved
# and ownership flipped. Also registers a premium numeric name.
#
# Preloading at genesis (`--bpf-program`) sidesteps the devnet SBPFv3 deploy gate.
# Prereqs: solana CLI 3.1.x, spl-token, pnpm, a prior `NO_DNA=1 anchor build`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SOLANS_ID="7pVCKp81EHJi2DbUtUXAkk2b3VtrUZwj2hWDakXY2dMf"
KEYPAIR="$HOME/.config/solana/id.json"
LEDGER="$(mktemp -d)"
SELLER_CLI=(pnpm --filter solans-cli exec tsx src/index.ts --cluster localnet --keypair "$KEYPAIR")

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
echo "    seller: $(solana address)  balance: $(solana balance)"

echo "==> Creating payment mint (6 dp), funded payer ATA, treasury"
MINTKP="$(mktemp)"; TREASKP="$(mktemp)"; FEEKP="$(mktemp)"; BUYERKP="$(mktemp)"
for kp in "$MINTKP" "$TREASKP" "$FEEKP" "$BUYERKP"; do
  solana-keygen new -s --no-bip39-passphrase --force -o "$kp" >/dev/null
done
MINT="$(solana address -k "$MINTKP")"; TREASURY="$(solana address -k "$TREASKP")"
SOL_TREASURY="$(solana address -k "$FEEKP")"; BUYER="$(solana address -k "$BUYERKP")"
spl-token create-token "$MINTKP" --decimals 6 >/dev/null
spl-token create-account "$MINT" >/dev/null
spl-token mint "$MINT" 1000000 >/dev/null
spl-token create-account "$MINT" "$TREASKP" >/dev/null
# Distinct staking + burn vaults so register_name's mutable token accounts don't
# collide (ConstraintDuplicateMutableAccount); both default to treasury otherwise.
STAKINGKP="$(mktemp)"; BURNKP="$(mktemp)"
solana-keygen new -s --no-bip39-passphrase --force -o "$STAKINGKP" >/dev/null
solana-keygen new -s --no-bip39-passphrase --force -o "$BURNKP" >/dev/null
spl-token create-account "$MINT" "$STAKINGKP" >/dev/null
spl-token create-account "$MINT" "$BURNKP" >/dev/null
STAKING="$(solana address -k "$STAKINGKP")"; BURN="$(solana address -k "$BURNKP")"
echo "    mint=$MINT  sol_treasury=$SOL_TREASURY  buyer=$BUYER"

echo "==> init-config (2% SOL marketplace fee)"
"${SELLER_CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY" --staking-vault "$STAKING" --burn-vault "$BURN" --sol-treasury "$SOL_TREASURY" --fee-bps 200

echo "==> register + list (5 SOL)"
"${SELLER_CLI[@]}" register alpha --no-nft
"${SELLER_CLI[@]}" list alpha 5
echo "--- info alpha (expect 'listed: 5 SOL') ---"
"${SELLER_CLI[@]}" info alpha

echo "==> fund the buyer and buy"
solana transfer "$BUYER" 10 --allow-unfunded-recipient >/dev/null
BUYER_CLI=(pnpm --filter solans-cli exec tsx src/index.ts --cluster localnet --keypair "$BUYERKP")
"${BUYER_CLI[@]}" buy alpha
echo "--- info alpha (expect new owner = $BUYER, no listing) ---"
"${SELLER_CLI[@]}" info alpha
echo "--- sol_treasury balance (expect ~0.1 SOL = 2% of 5) ---"
solana balance "$SOL_TREASURY"

echo "==> numeric premium: register a 2-digit number"
"${SELLER_CLI[@]}" register 42 --no-nft
"${SELLER_CLI[@]}" resolve 42

echo
echo "✅ Marketplace smoke complete: register -> list -> buy -> numeric premium OK"
