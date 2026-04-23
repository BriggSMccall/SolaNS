#!/usr/bin/env bash
#
# Localnet end-to-end smoke for $SOLANS staking (M5b): boot a validator with the
# SOLANS program preloaded, init-config, create the $SOLANS mint + staking pool
# (which repoints the §8.2 staker fee share at the pool reward vault), stake,
# drive a registration fee, then claim — confirming the staker earns the share.
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
ME="$(solana address)"

mk_vault() { local kp; kp="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$kp" >/dev/null 2>&1; spl-token create-account "$1" "$kp" >/dev/null 2>&1; solana address -k "$kp"; }

echo "==> Payment mint + funded payer ATA + treasury/burn vaults"
MINTKP="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$MINTKP" >/dev/null
MINT="$(solana address -k "$MINTKP")"
spl-token create-token "$MINTKP" --decimals 6 >/dev/null
spl-token create-account "$MINT" >/dev/null
spl-token mint "$MINT" 1000 >/dev/null
TREASURY="$(mk_vault "$MINT")"; BURN="$(mk_vault "$MINT")"

echo "==> init-config + register a numeric premium price for 5+ = 1 token"
"${CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY" --burn-vault "$BURN" --price5 1000000

echo "==> Create the \$SOLANS mint + funded staker ATA"
SOLANSKP="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$SOLANSKP" >/dev/null
SOLANS_MINT="$(solana address -k "$SOLANSKP")"
spl-token create-token "$SOLANSKP" --decimals 6 >/dev/null
spl-token create-account "$SOLANS_MINT" >/dev/null
spl-token mint "$SOLANS_MINT" 10 >/dev/null   # 10 $SOLANS to stake

echo "==> stake-init (creates the pool, repoints the staker fee share)"
"${CLI[@]}" stake-init "$SOLANS_MINT"

echo "==> stake 5 \$SOLANS, then drive a registration fee, then claim"
"${CLI[@]}" stake 5000000
"${CLI[@]}" register alpha --no-nft           # 25% of the 1-token fee -> pool reward vault
"${CLI[@]}" stake-info
REWARD_BEFORE="$(spl-token balance "$MINT")"
"${CLI[@]}" stake-claim
REWARD_AFTER="$(spl-token balance "$MINT")"
echo "    payment-mint balance before claim: $REWARD_BEFORE, after: $REWARD_AFTER (gained the staker share)"

echo
echo "✅ Staking smoke complete: stake -> earn the 25% fee share -> claim"
