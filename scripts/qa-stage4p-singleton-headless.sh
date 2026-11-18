#!/usr/bin/env bash
# Created by NMKato Solutions
# Pure native singleton-mode QA, no app start or signing.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
TMP="$(mktemp -d "/tmp/katosync-stage4p-singleton.XXXXXXXX")"
trap 'rm -rf "$TMP"' EXIT
rustc --edition=2021 --test "$ROOT/src-tauri/src/app_instance/process_mode.rs" -o "$TMP/identity"
"$TMP/identity" --nocapture
