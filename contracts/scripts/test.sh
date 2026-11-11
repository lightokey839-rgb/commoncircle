#!/usr/bin/env bash
# Full contracts run: wasm build, unit tests, sandbox tests. Linux/macOS/WSL only.
# Extra args go to cargo test (e.g. --offline).
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/build-wasm.sh
cargo test --workspace --no-fail-fast "$@" -- --test-threads=4
