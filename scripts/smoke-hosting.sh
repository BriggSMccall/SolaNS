#!/usr/bin/env bash
#
# Localnet end-to-end smoke for the hosting layer (M6, §6): boot a validator with
# SOLANS + Metaplex preloaded, register a name (mints the NFT by default), then set
# its hosting ref ON THE TOKENIZED NAME (proves the dynamic-attribute auth fix:
# the NFT holder manages hosting without redeeming), resolve the gateway URL via
# `host`, and show the `content`-record fallback.
#
# Preloading at genesis (`--bpf-program`) sidesteps the devnet SBPFv3 deploy gate.
# Prereqs: solana CLI 3.1.x, spl-token, pnpm, a prior `NO_DNA=1 anchor build` and
# tests/fixtures/mpl_token_metadata.so.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SOLANS_ID="7pVCKp81EHJi2DbUtUXAkk2b3VtrUZwj2hWDakXY2dMf"
MPL_ID="metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
KEYPAIR="$HOME/.config/solana/id.json"
LEDGER="$(mktemp -d)"
CLI=(pnpm --filter solans-cli exec tsx src/index.ts --cluster localnet --keypair "$KEYPAIR")
CID="QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"   # the IPFS readme

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

mk_vault() { local kp; kp="$(mktemp)"; solana-keygen new -s --no-bip39-passphrase --force -o "$kp" >/dev/null 2>&1; spl-token create-account "$1" "$kp" >/dev/null 2>&1; solana address -k "$kp"; }

echo "==> Payment mint + distinct treasury/staking/burn vaults + init-config"
MINTKP="$(mktemp)"
solana-keygen new -s --no-bip39-passphrase --force -o "$MINTKP" >/dev/null
MINT="$(solana address -k "$MINTKP")"
spl-token create-token "$MINTKP" --decimals 6 >/dev/null
spl-token create-account "$MINT" >/dev/null
spl-token mint "$MINT" 1000000 >/dev/null
TREASURY="$(mk_vault "$MINT")"; STAKING="$(mk_vault "$MINT")"; BURN="$(mk_vault "$MINT")"
"${CLI[@]}" init-config --mint "$MINT" --treasury "$TREASURY" --staking-vault "$STAKING" --burn-vault "$BURN"

echo "==> register alex (mints the NFT by default)"
"${CLI[@]}" register alex

echo "==> set-hosting on the TOKENIZED name (holder auth — no redeem needed)"
"${CLI[@]}" set-hosting alex "ipfs://$CID"
echo "--- host alex (expect ref + https://ipfs.io/ipfs/... URL) ---"
"${CLI[@]}" host alex

echo "==> clear hosting + set a 'content' record instead (fallback)"
"${CLI[@]}" set-hosting alex none
"${CLI[@]}" record set alex content "ipfs://$CID"
echo "--- host alex (now resolved from the content record) ---"
"${CLI[@]}" host alex

echo
echo "✅ Hosting smoke complete: register(NFT) -> set-hosting(tokenized) -> host URL -> content fallback"
