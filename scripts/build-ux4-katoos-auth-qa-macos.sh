#!/usr/bin/env bash
# Created by NMKato Solutions
# Isolated QA build, canonical KATOOS issuer. Never signs, notarizes, deploys or replaces Candidate 11.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "UX4_KATOOS_QA_REQUIRES_MACOS" >&2
  exit 2
fi
: "${CARGO_HOME:?Set an isolated external-SSD CARGO_HOME}"
: "${RUSTUP_HOME:?Set an isolated external-SSD RUSTUP_HOME}"
: "${CARGO_TARGET_DIR:?Set an isolated external-SSD CARGO_TARGET_DIR}"
for path in "$CARGO_HOME" "$RUSTUP_HOME" "$CARGO_TARGET_DIR"; do
  case "$path" in
    /Volumes/*) ;;
    *) echo "UX4_QA_EXTERNAL_SSD_REQUIRED" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -f src-tauri/tauri.ux4-katoos-auth-qa.conf.json ]]
[[ -f rust-toolchain.toml ]]
[[ -f src-tauri/Cargo.lock ]]
[[ -f package-lock.json ]]
[[ -d src-tauri/resources/poppler && -d src-tauri/resources/typst ]]
[[ -d src-tauri/resources/stt/KatoSyncSpeechHelper.app ]]
export PATH="$CARGO_HOME/bin:$PATH"
export CARGO_PROFILE_RELEASE_STRIP=none
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
export VITE_KATOOS_AUTH_QA=1

npm ci --no-audit --no-fund
npm run build
./node_modules/.bin/tauri build \
  --config src-tauri/tauri.ux4-katoos-auth-qa.conf.json \
  --features ux4-auth-qa \
  --no-sign --bundles app --ci -- --locked
printf '%s\n' "UX4_KATOOS_QA_BUILD_COMPLETE_UNSIGNED"
