#!/usr/bin/env bash
# Created by NMKato Solutions
# Pure native QA: no Tauri bundle, user resources, model server or cloud access.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
SOURCE="$ROOT/src-tauri/src/local_brain/inference_readiness.rs"
test -f "$SOURCE"
command -v rustc >/dev/null || { echo "STAGE4M_RUSTC_REQUIRED" >&2; exit 2; }
TMP="$(mktemp -d "/tmp/katosync-stage4m-inference-XXXXXXXX")"
cleanup() { rm -rf -- "$TMP"; }
trap cleanup EXIT
rustc --edition=2021 --test "$SOURCE" -o "$TMP/stage4m-inference-test"
"$TMP/stage4m-inference-test" --nocapture
