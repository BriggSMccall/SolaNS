#!/usr/bin/env bash
#
# Reproducible / verifiable build for the SOLANS program (Technical Concept §M8
# hardening). Produces a byte-for-byte reproducible `solans.so` via solana-verify's
# pinned Docker toolchain, so anyone can confirm the on-chain bytecode matches this
# exact source tree — the foundation of trust-minimized governance.
#
# Prerequisites:
#   - Docker running
#   - solana-verify:  cargo install solana-verify --locked
#
# Usage:
#   bash scripts/verify-build.sh                 # reproducible build + print hash
#   bash scripts/verify-build.sh <RPC_URL>       # also verify against the on-chain program
#
set -euo pipefail

PROGRAM_NAME="solans"
PROGRAM_ID="7pVCKp81EHJi2DbUtUXAkk2b3VtrUZwj2hWDakXY2dMf"
REPO_URL="${SOLANS_REPO_URL:-https://github.com/BriggSMccall/SolaNS}"
RPC_URL="${1:-}"

here() { cd "$(dirname "$0")/.."; }
here

need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ missing prerequisite: $1"; exit 1; }; }
need docker
need solana-verify

echo "▸ Reproducible build of '$PROGRAM_NAME' (solana-verify, pinned Docker toolchain)…"
# Mirrors the program's pins (rust-toolchain.toml = 1.89, Anchor 1.0.2). If the
# default base image's Solana differs, pass --base-image to match the deploy target.
solana-verify build --library-name "$PROGRAM_NAME"

echo
echo "▸ Executable hash (publish this alongside each release):"
HASH="$(solana-verify get-executable-hash "target/deploy/${PROGRAM_NAME}.so")"
echo "    ${PROGRAM_NAME}.so  sha256=${HASH}"

if [ -n "$RPC_URL" ]; then
  echo
  echo "▸ Verifying the deployed program matches this repo on ${RPC_URL}…"
  # Compares the on-chain executable hash to a fresh reproducible build of REPO_URL.
  solana-verify verify-from-repo \
    --url "$RPC_URL" \
    --program-id "$PROGRAM_ID" \
    --library-name "$PROGRAM_NAME" \
    "$REPO_URL"
fi

echo
echo "✓ done. Post-deploy, anyone can run:"
echo "    solana-verify verify-from-repo --url <rpc> --program-id ${PROGRAM_ID} ${REPO_URL}"
