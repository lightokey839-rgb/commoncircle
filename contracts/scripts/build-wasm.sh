#!/usr/bin/env bash
# Build the circle and mock-ft wasm with cargo-near (0.23.0) and copy them to
# $TARGET/near-wasm/ where the sandbox tests look for them.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${CARGO_TARGET_DIR:-$(pwd)/target}"
OUT="$TARGET/near-wasm"
mkdir -p "$OUT"
for crate in circle mock-ft; do
  (cd "$crate" && cargo near build non-reproducible-wasm --no-abi --out-dir "$OUT")
done
ls -l "$OUT"
sha256sum "$OUT"/*.wasm
