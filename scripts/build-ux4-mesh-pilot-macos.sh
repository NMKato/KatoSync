#!/usr/bin/env bash
# Created by NMKato Solutions — existing UX4 pairing paths, explicitly opted-in pilot.
# Builds only. Never installs, launches, enrolls, approves a peer or deploys a server.
set -euo pipefail
umask 077
[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || { echo "MACOS_ARM64_REQUIRED" >&2; exit 3; }
case "${1:-}" in ""|--check) ;; *) echo "USAGE: build-ux4-mesh-pilot-macos.sh [--check]" >&2; exit 2;; esac
[[ "${KATOSYNC_UX4_PAIRING_PILOT:-0}" == "1" ]] || { echo "EXPLICIT_PAIRING_PILOT_OPT_IN_REQUIRED" >&2; exit 4; }
: "${CARGO_HOME:?Isolated CARGO_HOME on external SSD required}"
: "${RUSTUP_HOME:?Isolated RUSTUP_HOME on external SSD required}"
: "${CARGO_TARGET_DIR:?Separate external SSD CARGO_TARGET_DIR required}"
for loc in "$CARGO_HOME" "$RUSTUP_HOME" "$CARGO_TARGET_DIR"; do
  case "$loc" in /Volumes/*) ;; *) echo "EXTERNAL_SSD_REQUIRED" >&2; exit 3;; esac
done
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
expected="${KATOSYNC_UX4_PAIRING_EXPECT_SHA:-}"
[[ "$expected" =~ ^[a-f0-9]{40}$ && "$(git rev-parse HEAD)" == "$expected" ]] || { echo "PILOT_SOURCE_SHA_MISMATCH" >&2; exit 3; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "PILOT_TRACKED_SOURCE_DIRTY" >&2; exit 3; }
[[ -s src-tauri/Cargo.lock && -s package-lock.json ]]
node -e '
const fs = require("node:fs");
const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const config = require("./src-tauri/tauri.ux4-katoos-auth-qa.conf.json");
if (!cargo.includes("ux4-mesh-qa = [\"ux4-auth-qa\", \"stage4j-qa\"]") ||
 config.identifier !== "com.nmkato.katosync.ux4katoosqa20261120" || config.bundle.macOS.signingIdentity !== null) process.exit(3);
'
export VITE_KATOOS_AUTH_QA=1
export VITE_MESH_INBOX_SEND_QA=1
export VITE_MESH_INBOX_RECEIVE_QA=1
export VITE_MESH_RELAY_QA=1
export VITE_MESH_EASY_PAIR_QA=1
# Native refuses heartbeat for identities which have not been explicitly enrolled.
export VITE_STAGE35_HEARTBEAT_QA=1
export VITE_STAGE35_AUTO_RESUME_QA=0
export KATOSYNC_MESH_INBOX_SEND_QA=1
export KATOSYNC_MESH_INBOX_RECEIVE_QA=1
export KATOSYNC_MESH_PAIRING_RELAY_QA=1
export PATH="$CARGO_HOME/bin:$PATH"
export CARGO_PROFILE_RELEASE_STRIP=none
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
if [[ "${1:-}" == "--check" ]]; then
  echo "UX4_PAIRING_PILOT_CONFIG_OK: signed presence, sender, receiver, relay; no device or command grants"
  exit 0
fi
[[ -d src-tauri/resources/poppler && -d src-tauri/resources/typst ]]
[[ -d src-tauri/resources/stt/KatoSyncSpeechHelper.app ]]
[[ ! -L node_modules ]] || { echo "PILOT_REQUIRES_OWN_NODE_MODULES" >&2; exit 3; }
npm ci --no-audit --no-fund
npm run build
./node_modules/.bin/tauri build \
  --config src-tauri/tauri.ux4-katoos-auth-qa.conf.json \
  --features ux4-mesh-qa --no-sign --bundles app --ci -- --locked
node -e '
const fs = require("node:fs"), path = require("node:path");
const manifest = { sourceSha: process.env.KATOSYNC_UX4_PAIRING_EXPECT_SHA, feature: "ux4-mesh-qa",
 signedPresenceEnabled: true, pairingSenderEnabled: true, pairingReceiverEnabled: true, pairingRelayEnabled: true,
 peerApprovalAutomatic: false, remoteCommandGrantsIssued: false, signedRelease: false };
fs.writeFileSync(path.join(process.env.CARGO_TARGET_DIR, "ux4-mesh-pilot-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
'
echo "UX4_PAIRING_PILOT_BUILT_UNSIGNED: native startup and two-device acceptance still required"
