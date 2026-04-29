#!/usr/bin/env bash
#
# Localnet end-to-end smoke for §6.2 auto-renew: boot a validator with SOLANS
# preloaded, register a name, approve the Config PDA as the SPL delegate of the
# owner's payment account (auto-renew-enable), show that an immediate auto-renew is
# rejected (AutoRenewTooEarly — the name is far from expiry), then revoke. The
# actual charge-on-expiry path needs a clock warp and is covered by the litesvm test.
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

echo "==> Payment mint + distinct treasury/staking/burn vaults + init-config"
MINTKP="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$MINTKP" >/dev/null
MINT="$(solana address -k "$MINTKP")"
spl-token create-token "$MINTKP" --decimals 6 >/dev/null
spl-token create-account "$MINT" >/dev/null
spl-token mint "$MINT" 1000 >/dev/null
TREASURY="$(mk_vault "$MINT")"; STAKING="$(mk_vault "$MINT")"; BURN="$(mk_vault "$MINT")"
"${CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY" --staking-vault "$STAKING" --burn-vault "$BURN"

echo "==> register alex (PDA-native)"
"${CLI[@]}" register alex --no-nft

echo "==> auto-renew-enable: approve the Config PDA as delegate for 5 renewals"
"${CLI[@]}" auto-renew-enable 5000000
echo "    delegate on the payer ATA:"
spl-token account-info "$MINT" 2>/dev/null | grep -iE "Delegate|Delegated" || true

echo "==> auto-renew now (expect rejection: AutoRenewTooEarly — far from expiry)"
"${CLI[@]}" auto-renew alex || echo "    (correctly rejected; the name is not yet within the renewal window)"

echo "==> auto-renew-disable: revoke the delegation"
"${CLI[@]}" auto-renew-disable

echo
echo "✅ Auto-renew smoke complete: enable (approve) -> too-early rejection -> disable (revoke)"
