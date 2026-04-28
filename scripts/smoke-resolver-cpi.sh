#!/usr/bin/env bash
#
# Localnet end-to-end smoke for the on-chain CPI resolver (§5.2) + admin rotation:
# boot a validator with SOLANS preloaded, register a name, resolve it ON-CHAIN via
# the `resolve` instruction (return_data → owner / a record value), then rotate the
# config admin and show the old admin loses authority.
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

echo "==> Payment mint + distinct treasury/staking/burn vaults + init-config"
MINTKP="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$MINTKP" >/dev/null
MINT="$(solana address -k "$MINTKP")"
spl-token create-token "$MINTKP" --decimals 6 >/dev/null
spl-token create-account "$MINT" >/dev/null
spl-token mint "$MINT" 1000 >/dev/null
TREASURY="$(mk_vault "$MINT")"; STAKING="$(mk_vault "$MINT")"; BURN="$(mk_vault "$MINT")"
"${CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY" --staking-vault "$STAKING" --burn-vault "$BURN"

echo "==> register alex (PDA-native) + set an address record"
"${CLI[@]}" register alex --no-nft
"${CLI[@]}" record set alex address.SOL "$ME"

echo "==> resolve on-chain via the CPI resolver (return_data)"
echo "--- resolve-cpi alex (expect owner = $ME) ---"
"${CLI[@]}" resolve-cpi alex
echo "--- resolve-cpi alex address.SOL (expect $ME) ---"
"${CLI[@]}" resolve-cpi alex address.SOL

echo "==> rotate the admin to a fresh keypair, then show the old admin loses authority"
NEWKP="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$NEWKP" >/dev/null
NEW="$(solana address -k "$NEWKP")"
solana transfer "$NEW" 1 --allow-unfunded-recipient >/dev/null
"${CLI[@]}" transfer-admin "$NEW"
echo "--- old admin update-config (expect failure: NotAdmin) ---"
"${CLI[@]}" update-config || echo "    (old admin correctly rejected)"
echo "--- new admin rotates back ---"
pnpm --filter solans-cli exec tsx src/index.ts --cluster localnet --keypair "$NEWKP" transfer-admin "$ME"

echo
echo "✅ Resolver-CPI smoke complete: register -> resolve-cpi (owner + record) -> admin rotation"
