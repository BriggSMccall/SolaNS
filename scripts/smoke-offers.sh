#!/usr/bin/env bash
#
# Localnet end-to-end smoke for marketplace offers (M4b): boot a validator with
# the SOLANS program preloaded, init-config (SOL fee treasury), then exercise
# register -> a second wallet makes a SOL offer -> the owner accepts it ->
# confirm SOL moved + ownership flipped. Also shows a make -> cancel refund.
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
echo "    seller: $(solana address)"

echo "==> Creating payment mint (6 dp), funded payer ATA, treasury"
MINTKP="$(mktemp)"; TREASKP="$(mktemp)"; FEEKP="$(mktemp)"; BIDDERKP="$(mktemp)"
for kp in "$MINTKP" "$TREASKP" "$FEEKP" "$BIDDERKP"; do
  solana-keygen new -s --no-bip39-passphrase --force -o "$kp" >/dev/null
done
MINT="$(solana address -k "$MINTKP")"; TREASURY="$(solana address -k "$TREASKP")"
SOL_TREASURY="$(solana address -k "$FEEKP")"; BIDDER="$(solana address -k "$BIDDERKP")"
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
echo "    mint=$MINT  sol_treasury=$SOL_TREASURY  bidder=$BIDDER"

echo "==> init-config (2% SOL marketplace fee) + register"
"${SELLER_CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY" --staking-vault "$STAKING" --burn-vault "$BURN" --sol-treasury "$SOL_TREASURY" --fee-bps 200
"${SELLER_CLI[@]}" register alpha --no-nft

echo "==> fund the bidder; bidder makes a 3 SOL offer"
solana transfer "$BIDDER" 10 --allow-unfunded-recipient >/dev/null
BIDDER_CLI=(pnpm --filter solans-cli exec tsx src/index.ts --cluster localnet --keypair "$BIDDERKP")
"${BIDDER_CLI[@]}" offer alpha 3

echo "==> seller accepts the offer"
"${SELLER_CLI[@]}" accept-offer alpha "$BIDDER"
echo "--- info alpha (expect owner = $BIDDER) ---"
"${SELLER_CLI[@]}" info alpha
echo "--- sol_treasury balance (expect ~0.06 SOL = 2% of 3) ---"
solana balance "$SOL_TREASURY"

echo "==> make -> cancel refund: bidder offers again, then cancels"
"${BIDDER_CLI[@]}" offer alpha 2
BIDDER_BAL_BEFORE="$(solana balance "$BIDDER" | awk '{print $1}')"
"${BIDDER_CLI[@]}" cancel-offer alpha
echo "    bidder balance before cancel: $BIDDER_BAL_BEFORE SOL, after: $(solana balance "$BIDDER" | awk '{print $1}') SOL (escrow refunded)"

echo
echo "✅ Offers smoke complete: register -> offer -> accept + cancel refund OK"
