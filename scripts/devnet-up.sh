#!/usr/bin/env bash
#
# Bring SOLANS up on devnet end-to-end: deploy the program (existing dev id),
# create a payment mint + treasury/staking/burn vaults, init-config, and wire the
# web app's local env to this deployment. Idempotent enough to re-run (each run
# deploys/upgrades and provisions a fresh mint).
#
# The on-chain part is funded — run `solana balance` first; needs ~6 devnet SOL on
# the deployer (~5.2 SOL program rent + mint/init + fees). Fund via
# https://faucet.solana.com if the CLI airdrop is rate-limited.
#
# After this, start the services (indexer + forwarder + web) — see the printed next steps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"

RPC="${SOLANS_RPC_URL:-https://api.devnet.solana.com}"
KEYPAIR="${SOLANS_KEYPAIR:-$HOME/.config/solana/id.json}"
CLI=(pnpm --filter solans-cli exec tsx src/index.ts --url "$RPC" --keypair "$KEYPAIR")

solana config set --url "$RPC" --keypair "$KEYPAIR" >/dev/null
BAL="$(solana balance | awk '{print $1}')"
echo "▸ deployer $(solana address) — balance ${BAL} SOL on $RPC"
awk "BEGIN{exit !(${BAL} < 6)}" && { echo "✗ need ~6 SOL; fund the deployer and re-run."; exit 1; }

echo "▸ Building program (NO_DNA=1 anchor build)…"
NO_DNA=1 anchor build

echo "▸ Deploying to devnet (program id 7pVCKp81…)…"
solana program deploy target/deploy/solans.so --program-id target/deploy/solans-keypair.json

echo "▸ Regenerating typed client from the deployed IDL…"
pnpm generate

echo "▸ Provisioning payment mint (6-dec) + treasury/staking/burn vaults…"
MINTKP="$(mktemp)"; TREASKP="$(mktemp)"; STAKINGKP="$(mktemp)"; BURNKP="$(mktemp)"
for kp in "$MINTKP" "$TREASKP" "$STAKINGKP" "$BURNKP"; do
  solana-keygen new -s --no-bip39-passphrase --force -o "$kp" >/dev/null
done
MINT="$(solana address -k "$MINTKP")"
TREASURY="$(solana address -k "$TREASKP")"
STAKING="$(solana address -k "$STAKINGKP")"
BURN="$(solana address -k "$BURNKP")"
spl-token create-token "$MINTKP" --decimals 6 >/dev/null
spl-token create-account "$MINT" >/dev/null            # deployer ATA
spl-token mint "$MINT" 1000000 >/dev/null              # 1,000,000 tokens to deployer (for web forge)
spl-token create-account "$MINT" "$TREASKP" >/dev/null
spl-token create-account "$MINT" "$STAKINGKP" >/dev/null
spl-token create-account "$MINT" "$BURNKP" >/dev/null
echo "    mint=$MINT  treasury=$TREASURY"

echo "▸ init-config…"
"${CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY" --staking-vault "$STAKING" --burn-vault "$BURN"

echo "▸ Wiring web/.env.local (DEV_KEYPAIR = deployer, holds SOL + payment tokens)…"
ENVF="web/.env.local"
grep -v '^NEXT_PUBLIC_SOLANS_DEV_KEYPAIR=' "$ENVF" 2>/dev/null > "${ENVF}.tmp" || true
mv "${ENVF}.tmp" "$ENVF"
printf 'NEXT_PUBLIC_SOLANS_DEV_KEYPAIR=%s\n' "$(cat "$KEYPAIR")" >> "$ENVF"

cat <<EOF

✓ Devnet on-chain bring-up complete.
  program  : 7pVCKp81EHJi2DbUtUXAkk2b3VtrUZwj2hWDakXY2dMf
  mint     : $MINT
  treasury : $TREASURY

Next (services, run from repo root):
  1) indexer:   PORT=8788 pnpm --filter solans-indexer start
  2) forwarder: SOLANS_RPC_URL=$RPC INDEXER_URL=http://localhost:8788 \\
                  node services/indexer/forward-localnet.mjs      # re-run to catch new txs
  3) web:       pnpm --filter web dev    # http://localhost:3000  (connects as dev wallet)
EOF
