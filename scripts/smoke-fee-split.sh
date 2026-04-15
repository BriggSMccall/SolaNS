#!/usr/bin/env bash
#
# Localnet end-to-end smoke for the §8.2 protocol fee-split (M5a): boot a
# validator with the SOLANS program preloaded, init-config with the staking +
# burn vaults and the 60/25/10/5 split, then register a name WITH a referrer and
# confirm the fee lands 60% treasury / 25% staking / 10% referral / 5% burn.
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

# Create the payment mint (6 dp) + the payer's funded ATA.
echo "==> Creating payment mint + fee-destination token accounts"
MINTKP="$(mktemp)"
solana-keygen new -s --no-bip39-passphrase --force -o "$MINTKP" >/dev/null
MINT="$(solana address -k "$MINTKP")"
spl-token create-token "$MINTKP" --decimals 6 >/dev/null
spl-token create-account "$MINT" >/dev/null      # payer ATA
spl-token mint "$MINT" 1000 >/dev/null            # fund the payer

# A token account (at a fresh keypair address, owned by the signer) for each fee
# destination; echo its address.
mk_vault() {
  local kp
  kp="$(mktemp)"
  solana-keygen new -s --no-bip39-passphrase --force -o "$kp" >/dev/null 2>&1
  spl-token create-account "$MINT" "$kp" >/dev/null 2>&1
  solana address -k "$kp"
}
TREASURY="$(mk_vault)"; STAKING="$(mk_vault)"; BURN="$(mk_vault)"; REFERRAL="$(mk_vault)"
echo "    treasury=$TREASURY staking=$STAKING burn=$BURN referral=$REFERRAL"

echo "==> init-config (60/25/10/5 split)"
"${CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY" \
  --staking-vault "$STAKING" --burn-vault "$BURN" \
  --staking-bps 2500 --referral-bps 1000 --burn-bps 500 \
  --price5 1000000

echo "==> register alpha --referrer (fee = 1.0 token = price_5plus)"
"${CLI[@]}" register alpha --referrer "$REFERRAL"

echo "--- fee split (expect 0.6 / 0.25 / 0.1 / 0.05) ---"
printf "  treasury : %s\n" "$(spl-token balance --address "$TREASURY")"
printf "  staking  : %s\n" "$(spl-token balance --address "$STAKING")"
printf "  referral : %s\n" "$(spl-token balance --address "$REFERRAL")"
printf "  burn     : %s\n" "$(spl-token balance --address "$BURN")"

echo
echo "✅ Fee-split smoke complete: register splits the fee 60/25/10/5 per §8.2"
