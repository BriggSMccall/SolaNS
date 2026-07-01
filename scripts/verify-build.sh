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
# Canonical mainnet program id (matches declare_id! / Anchor.toml). Used only for
# the optional on-chain `verify-from-repo` comparison — the build itself is keyless.
PROGRAM_ID="AiDB9oh4jMKuGnx4nEseMgW7qpMnswygx6wpFKJbXKfb"
REPO_URL="${SOLANS_REPO_URL:-https://github.com/BriggSMccall/SolaNS}"
RPC_URL="${1:-}"
# Pin the verifiable-build base image to the program's Solana version (3.1.10). The
# solana-verify *default* image ships an older Cargo (1.84) that can't parse the
# program's `edition2024` transitive deps — this image's platform-tools toolchain
# matches `rust-toolchain.toml` (1.89) + Solana 3.1.10. Override for a re-pin.
BASE_IMAGE="${SOLANS_VERIFY_BASE_IMAGE:-solanafoundation/solana-verifiable-build:3.1.10}"

here() { cd "$(dirname "$0")/.."; }
here

need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ missing prerequisite: $1"; exit 1; }; }
need docker
need solana-verify

echo "▸ Reproducible build of '$PROGRAM_NAME' (solana-verify, base image ${BASE_IMAGE})…"
solana-verify build --library-name "$PROGRAM_NAME" --base-image "$BASE_IMAGE"

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
