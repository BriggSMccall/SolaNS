#!/usr/bin/env bash
#
# Localnet end-to-end smoke for English auctions (M4c, §9.1): boot a validator with
# SOLANS preloaded, enable $SOLANS, then exercise register -> auction-start -> bid
# (wallet B) -> outbid (wallet C, B refunded) -> auction-info, plus a no-bid
# auction-cancel. The winner-settle path needs a 5-min wait (anti-snipe auto-extend
# pushes the close out on every bid), so it's covered by the litesvm tests instead.
#
# Preloading at genesis (`--bpf-program`) sidesteps the devnet SBPFv3 deploy gate.
# Prereqs: solana CLI 3.1.x, spl-token, pnpm, a prior `NO_DNA=1 anchor build`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SOLANS_ID="7pVCKp81EHJi2DbUtUXAkk2b3VtrUZwj2hWDakXY2dMf"
KEYPAIR="$HOME/.config/solana/id.json"
LEDGER="$(mktemp -d)"
SELLER=(pnpm --filter solans-cli exec tsx src/index.ts --cluster localnet --keypair "$KEYPAIR")

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

echo "==> Payment mint + funded payer ATA + distinct treasury/staking/burn vaults"
MINTKP="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$MINTKP" >/dev/null
MINT="$(solana address -k "$MINTKP")"
spl-token create-token "$MINTKP" --decimals 6 >/dev/null
spl-token create-account "$MINT" >/dev/null
spl-token mint "$MINT" 1000 >/dev/null
TREASURY="$(mk_vault "$MINT")"; STAKING="$(mk_vault "$MINT")"; BURN="$(mk_vault "$MINT")"

echo "==> init-config (2% marketplace fee; 5+ price = 1 token)"
"${SELLER[@]}" init-config --mint "$MINT" --treasury "$TREASURY" --staking-vault "$STAKING" --burn-vault "$BURN" --fee-bps 200 --price5 1000000

echo "==> Create \$SOLANS, enable §8.1, fund the seller with \$SOLANS"
SOLANSKP="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$SOLANSKP" >/dev/null
SOLANS_MINT="$(solana address -k "$SOLANSKP")"
spl-token create-token "$SOLANSKP" --decimals 6 >/dev/null
spl-token create-account "$SOLANS_MINT" >/dev/null
spl-token mint "$SOLANS_MINT" 100 >/dev/null
"${SELLER[@]}" burn-init "$SOLANS_MINT"
"${SELLER[@]}" solans-params --rate 1000000 --discount-bps 0

echo "==> Two bidders: fund SOL + 5 \$SOLANS each"
BKP="$(mktemp)"; CKP="$(mktemp)"
solana-keygen new -s --no-bip39-passphrase --force -o "$BKP" >/dev/null
solana-keygen new -s --no-bip39-passphrase --force -o "$CKP" >/dev/null
B="$(solana address -k "$BKP")"; C="$(solana address -k "$CKP")"
solana transfer "$B" 5 --allow-unfunded-recipient >/dev/null
solana transfer "$C" 5 --allow-unfunded-recipient >/dev/null
spl-token transfer "$SOLANS_MINT" 5 "$B" --fund-recipient --allow-unfunded-recipient >/dev/null
spl-token transfer "$SOLANS_MINT" 5 "$C" --fund-recipient --allow-unfunded-recipient >/dev/null
B_CLI=(pnpm --filter solans-cli exec tsx src/index.ts --cluster localnet --keypair "$BKP")
C_CLI=(pnpm --filter solans-cli exec tsx src/index.ts --cluster localnet --keypair "$CKP")

echo "==> register foo + open an auction (reserve 1 \$SOLANS, +0.1 increment)"
"${SELLER[@]}" register foo
"${SELLER[@]}" auction-start foo --reserve 1000000 --increment 100000 --days 1

echo "==> B bids 2 \$SOLANS, then C outbids with 3 \$SOLANS (B refunded)"
"${B_CLI[@]}" bid foo 2000000
"${C_CLI[@]}" bid foo 3000000
echo "    B \$SOLANS balance: $(spl-token balance "$SOLANS_MINT" --owner "$B") (refunded to 5)"
echo "    C \$SOLANS balance: $(spl-token balance "$SOLANS_MINT" --owner "$C") (2 left after a 3 bid)"
"${SELLER[@]}" auction-info foo

echo "==> register bar + open + cancel (no bids → unfreeze)"
"${SELLER[@]}" register bar
"${SELLER[@]}" auction-start bar --reserve 1000000
"${SELLER[@]}" auction-cancel bar
echo "--- info bar (expect NOT listed) ---"
"${SELLER[@]}" info bar

echo
echo "✅ Auction smoke complete: start -> bid -> outbid (refund) -> info -> cancel"
