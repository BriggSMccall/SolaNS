#!/usr/bin/env bash
#
# Rotate the on-chain program id from the committed dev/CI keypair to a fresh,
# secret keypair — the FIRST step of the mainnet cutover (§M8). Run this only when
# you are actually deploying to mainnet (after the audit), with the new keypair in
# hand. It rewrites the single id constant everywhere, rebuilds, and regenerates the
# clients so the whole tree is pinned to the new id.
#
# IMPORTANT: this changes the canonical program id, which orphans the dev-id
# testnet/localnet deployments. Do it on a dedicated "mainnet release" commit/branch.
# The new keypair's SECRET must NOT be committed — deploy with it via --program-id.
#
# Usage:
#   bash scripts/rotate-program-id.sh ~/.config/solana/solans-mainnet-program.json
#
set -euo pipefail
cd "$(dirname "$0")/.."

OLD_ID="7pVCKp81EHJi2DbUtUXAkk2b3VtrUZwj2hWDakXY2dMf"
KEYPAIR="${1:?usage: rotate-program-id.sh <new-program-keypair.json>}"
[ -f "$KEYPAIR" ] || { echo "✗ keypair not found: $KEYPAIR"; exit 1; }
NEW_ID="$(solana address -k "$KEYPAIR")"

echo "▸ Rotating program id:"
echo "    $OLD_ID  (dev/CI)"
echo " -> $NEW_ID  (from $KEYPAIR)"
read -r -p "Proceed? This rewrites declare_id! and rebuilds. [y/N] " ok
[ "$ok" = "y" ] || { echo "aborted."; exit 1; }

# 1. The single source-of-truth constants (the generated TS client is regenerated below).
sed -i '' "s/$OLD_ID/$NEW_ID/g" \
  programs/solans/src/lib.rs \
  Anchor.toml \
  clients/rust/src/lib.rs

# 2. Place the keypair where `anchor build` claims the address (target/ is gitignored,
#    so the secret never enters git).
mkdir -p target/deploy
cp "$KEYPAIR" target/deploy/solans-keypair.json

# 3. Rebuild the program + regenerate the typed client + revalidate Rust parity.
echo "▸ Rebuilding program (NO_DNA=1 anchor build)…"
NO_DNA=1 anchor build
echo "▸ Regenerating the TS client from the new IDL…"
pnpm generate
echo "▸ Revalidating the Rust client parity vectors…"
( cd clients/rust && cargo test ) || echo "  (review clients/rust parity if this failed)"

echo
echo "✓ Rotated to $NEW_ID."
echo "  Next: bash scripts/verify-build.sh   (publish the new mainnet hash)"
echo "        solana program deploy target/deploy/solans.so \\"
echo "          --program-id $KEYPAIR --url mainnet-beta   (deployer funded ~8-10 SOL)"
echo "  Optionally update the hardcoded id in scripts/*.sh + docs for cosmetic consistency."
