#!/usr/bin/env bash
#
# Localnet end-to-end smoke for subdomains (M3): boot a validator with the SOLANS
# program preloaded, create a payment mint/treasury, init-config, then exercise
# register -> subdomain create -> resolve -> record set -> revoke via the CLI.
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
echo "    balance: $(solana balance)"

echo "==> Creating payment mint (6 dp), funded payer ATA, treasury"
MINTKP="$(mktemp)"; TREASKP="$(mktemp)"
solana-keygen new -s --no-bip39-passphrase --force -o "$MINTKP" >/dev/null
solana-keygen new -s --no-bip39-passphrase --force -o "$TREASKP" >/dev/null
MINT="$(solana address -k "$MINTKP")"; TREASURY="$(solana address -k "$TREASKP")"
spl-token create-token "$MINTKP" --decimals 6 >/dev/null
spl-token create-account "$MINT" >/dev/null
spl-token mint "$MINT" 1000000 >/dev/null
spl-token create-account "$MINT" "$TREASKP" >/dev/null
echo "    mint=$MINT treasury=$TREASURY"

echo "==> init-config + register parent"
"${CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY"
"${CLI[@]}" register alex

echo "==> subdomain create + resolve"
"${CLI[@]}" subdomain create alex pay
echo "--- resolve pay.alex.sol ---"
"${CLI[@]}" resolve pay.alex.sol
echo "--- set a record on the subdomain, then read it back ---"
"${CLI[@]}" record set pay.alex.sol url https://pay.alex.sol
"${CLI[@]}" info pay.alex.sol

echo "==> subdomain revoke"
"${CLI[@]}" subdomain revoke alex pay
echo "--- resolve pay.alex.sol (expect: not registered) ---"
"${CLI[@]}" resolve pay.alex.sol || true

echo
echo "✅ Subdomain smoke complete: register -> create -> resolve -> revoke OK"
