#!/usr/bin/env bash
#
# Deploy SOLANS to devnet (or any cluster via SOLANS_RPC_URL) and run an
# end-to-end smoke test: deploy -> create payment mint/treasury -> init-config
# -> register -> resolve.
#
# Prerequisites: anchor 1.0.x, solana CLI 3.1.x, spl-token, pnpm, and a wallet
# funded with ~3 devnet SOL (the 300KB program needs ~2.5 SOL of rent).
# Devnet's CLI airdrop is rate-limited; if it fails, fund your wallet at
# https://faucet.solana.com and re-run.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CLUSTER_URL="${SOLANS_RPC_URL:-https://api.devnet.solana.com}"
KEYPAIR="${SOLANS_KEYPAIR:-$HOME/.config/solana/id.json}"
CLI=(pnpm --filter solans-cli exec tsx src/index.ts --url "$CLUSTER_URL" --keypair "$KEYPAIR")

echo "==> Building program"
NO_DNA=1 anchor build

echo "==> Targeting $CLUSTER_URL with $KEYPAIR"
solana config set --url "$CLUSTER_URL" --keypair "$KEYPAIR" >/dev/null
solana airdrop 2 || echo "    (airdrop rate-limited — fund the wallet at https://faucet.solana.com and re-run)"
echo "    balance: $(solana balance)"

echo "==> Deploying program"
solana program deploy target/deploy/solans.so --program-id target/deploy/solans-keypair.json

echo "==> Regenerating the typed client from the deployed IDL"
pnpm generate

echo "==> Creating a 6-decimal payment mint, payer ATA (funded), and treasury"
MINTKP="$(mktemp)"; TREASKP="$(mktemp)"
solana-keygen new -s --no-bip39-passphrase --force -o "$MINTKP" >/dev/null
solana-keygen new -s --no-bip39-passphrase --force -o "$TREASKP" >/dev/null
MINT="$(solana address -k "$MINTKP")"
TREASURY="$(solana address -k "$TREASKP")"
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
echo "    mint=$MINT"
echo "    treasury=$TREASURY"

echo "==> init-config"
"${CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY" --staking-vault "$STAKING" --burn-vault "$BURN"

echo "==> register + resolve smoke"
"${CLI[@]}" register alex --no-nft
"${CLI[@]}" resolve alex

cat <<EOF

Done. Export these to use the CLI against this deployment:
  export SOLANS_RPC_URL=$CLUSTER_URL
  export SOLANS_MINT=$MINT
  export SOLANS_TREASURY=$TREASURY
EOF
