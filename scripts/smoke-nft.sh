#!/usr/bin/env bash
#
# Localnet end-to-end smoke for the NFT layer (M2): boot a validator with the
# SOLANS + Metaplex Token Metadata programs preloaded, create a payment
# mint/treasury, init-config, then exercise register -> tokenize -> redeem via
# the CLI, asserting the NFT shows up (spl-token) and `info` reflects it.
#
# Preloading both programs at genesis (`--bpf-program`) sidesteps the devnet
# SBPFv3 deploy gate; the local validator enables all features, so the current
# mainnet Metaplex binary executes fine.
#
# Prereqs: solana CLI 3.1.x, spl-token, pnpm, a prior `NO_DNA=1 anchor build`
# (so target/deploy/solans.so exists) and tests/fixtures/mpl_token_metadata.so.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SOLANS_ID="7pVCKp81EHJi2DbUtUXAkk2b3VtrUZwj2hWDakXY2dMf"
MPL_ID="metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
KEYPAIR="$HOME/.config/solana/id.json"
LEDGER="$(mktemp -d)"
CLI=(pnpm --filter solans-cli exec tsx src/index.ts --cluster localnet --keypair "$KEYPAIR")

[[ -f target/deploy/solans.so ]] || { echo "build first: NO_DNA=1 anchor build"; exit 1; }
[[ -f tests/fixtures/mpl_token_metadata.so ]] || { echo "missing Metaplex fixture"; exit 1; }

echo "==> Booting validator (SOLANS + Metaplex preloaded)"
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --bpf-program "$SOLANS_ID" target/deploy/solans.so \
  --bpf-program "$MPL_ID" tests/fixtures/mpl_token_metadata.so &
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

echo "==> init-config + register"
"${CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY"
"${CLI[@]}" register alpha

echo "==> tokenize"
"${CLI[@]}" tokenize alpha
echo "--- info (expect 'tokenized') ---"
"${CLI[@]}" info alpha
echo "--- spl-token accounts (expect an NFT with balance 1) ---"
spl-token accounts

echo "==> redeem"
"${CLI[@]}" redeem alpha
echo "--- info (expect NO 'tokenized' line) ---"
"${CLI[@]}" info alpha

echo
echo "✅ NFT smoke complete: register -> tokenize -> redeem round-trip OK"
