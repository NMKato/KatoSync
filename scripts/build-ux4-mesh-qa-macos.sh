#!/usr/bin/env bash
# Created by NMKato Solutions – isolated private UX4/Stage4J Mesh QA build.
# Build only. Does not start app, copy session data, grant devices or deploy a server.
set -euo pipefail
[[ "$(uname -s)" == "Darwin" ]] || { echo "MACOS_REQUIRED" >&2; exit 3; }
: "${CARGO_HOME:?Isolated CARGO_HOME on external SSD required}"
: "${RUSTUP_HOME:?Isolated RUSTUP_HOME on external SSD required}"
: "${CARGO_TARGET_DIR:?New external SSD CARGO_TARGET_DIR required}"
for loc in "$CARGO_HOME" "$RUSTUP_HOME" "$CARGO_TARGET_DIR"; do
  case "$loc" in /Volumes/*) ;; *) echo "EXTERNAL_SSD_REQUIRED" >&2; exit 3;; esac
done
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -f src-tauri/tauri.ux4-katoos-auth-qa.conf.json ]]
[[ -s src-tauri/Cargo.lock && -s package-lock.json ]]
[[ -d src-tauri/resources/poppler && -d src-tauri/resources/typst ]]
[[ -d src-tauri/resources/stt/KatoSyncSpeechHelper.app ]]
node -e '
const fs=require("node:fs");
const t=fs.readFileSync("src-tauri/Cargo.toml","utf8");
const c=require("./src-tauri/tauri.ux4-katoos-auth-qa.conf.json");
if(!t.includes("ux4-mesh-qa = [\"ux4-auth-qa\", \"stage4j-qa\"]") ||
  c.identifier!=="com.nmkato.katosync.ux4katoosqa20261120" ||
  c.bundle.macOS.signingIdentity!==null)process.exit(3);
'
# This candidate is a read-only/registered-device beta, not a live pairing
# distribution. A separate owner-reviewed build must explicitly opt in to the
# sender, receiver and relay QA paths on each physical device.
for flag in VITE_MESH_INBOX_SEND_QA VITE_MESH_INBOX_RECEIVE_QA KATOSYNC_MESH_INBOX_SEND_QA KATOSYNC_MESH_INBOX_RECEIVE_QA KATOSYNC_MESH_PAIRING_RELAY_QA; do
  if [[ "${!flag:-0}" == "1" ]]; then
    echo "UX4_MESH_PAIRING_PRIVATE_GATE_REQUIRES_SEPARATE_APPROVAL" >&2
    exit 4
  fi
done
export VITE_MESH_INBOX_SEND_QA=0
export VITE_MESH_INBOX_RECEIVE_QA=0
export PATH="$CARGO_HOME/bin:$PATH"
export CARGO_PROFILE_RELEASE_STRIP=none
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
export VITE_KATOOS_AUTH_QA=1
npm ci --no-audit --no-fund
npm run build
./node_modules/.bin/tauri build \
 --config src-tauri/tauri.ux4-katoos-auth-qa.conf.json \
 --features ux4-mesh-qa \
 --no-sign --bundles app --ci -- --locked
printf '%s\n' "UX4_MESH_QA_BUILD_READY_UNSIGNED"
