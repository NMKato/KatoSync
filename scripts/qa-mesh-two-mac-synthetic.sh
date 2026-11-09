#!/usr/bin/env bash
# NMKato Solutions — one-shot two-host synthetic TLS 1.3 QA only.
# NOT an installer, enrollment, real-device pairing or remote-job runner.
set -euo pipefail
umask 077
ALLOW="$(printenv KATOSYNC_MESH_LAN_QA_ALLOW || true)"
ROLE="$(printenv KATOSYNC_MESH_LAN_QA_ROLE || true)"
ADDRESS="$(printenv KATOSYNC_MESH_LAN_QA_ADDRESS || true)"
PEER="$(printenv KATOSYNC_MESH_LAN_QA_EXPECT_PEER || true)"
NEGATIVE="$(printenv KATOSYNC_MESH_LAN_QA_NEGATIVE || true)"
SCAFFOLD="$(printenv KATOSYNC_MESH_LAN_QA_SCAFFOLD || true)"
if [[ "$ALLOW" != "SYNTHETIC_FIXTURES_ONLY" ]]; then
  echo "MESH_LAN_QA_BLOCKED: synthetic-only explicit authorization missing" >&2
  exit 2
fi
case "$ROLE" in
  server|client|client-wrong-pin) ;;
  *) echo "MESH_LAN_QA_BLOCKED: invalid role" >&2; exit 2 ;;
esac
if [[ -z "$ADDRESS" || -z "$PEER" ]]; then
  echo "MESH_LAN_QA_BLOCKED: explicit private LAN address and peer required" >&2
  exit 2
fi
if [[ -n "$NEGATIVE" ]] && [[ "$ROLE" != "server" || "$NEGATIVE" != "YES" ]]; then
  echo "MESH_LAN_QA_BLOCKED: negative server expectation invalid" >&2
  exit 2
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NEW_POPPLER=0
NEW_TYPST=0
NEW_DIST=0
NEW_INDEX=0
cleanup() {
  if [[ "$NEW_POPPLER" == 1 ]]; then
    /bin/rm -f -- "$ROOT/src-tauri/resources/poppler/.test-only"
    rmdir -- "$ROOT/src-tauri/resources/poppler" 2>/dev/null || :
  fi
  if [[ "$NEW_TYPST" == 1 ]]; then
    /bin/rm -f -- "$ROOT/src-tauri/resources/typst/.test-only"
    rmdir -- "$ROOT/src-tauri/resources/typst" 2>/dev/null || :
  fi
  if [[ "$NEW_INDEX" == 1 ]]; then
    /bin/rm -f -- "$ROOT/dist/index.html"
  fi
  if [[ "$NEW_DIST" == 1 ]]; then
    rmdir -- "$ROOT/dist" 2>/dev/null || :
  fi
}
trap cleanup EXIT
if [[ ! -d "$ROOT/src-tauri/resources/poppler" ]]; then
  if [[ "$SCAFFOLD" != "YES" ]]; then
    echo "MESH_LAN_QA_BLOCKED: missing Poppler QA resource; opt in to synthetic scaffold" >&2
    exit 2
  fi
  mkdir -- "$ROOT/src-tauri/resources/poppler"
  printf 'SYNTHETIC QA ONLY\n' > "$ROOT/src-tauri/resources/poppler/.test-only"
  NEW_POPPLER=1
fi
if [[ ! -d "$ROOT/src-tauri/resources/typst" ]]; then
  if [[ "$SCAFFOLD" != "YES" ]]; then
    echo "MESH_LAN_QA_BLOCKED: missing Typst QA resource; opt in to synthetic scaffold" >&2
    exit 2
  fi
  mkdir -- "$ROOT/src-tauri/resources/typst"
  printf 'SYNTHETIC QA ONLY\n' > "$ROOT/src-tauri/resources/typst/.test-only"
  NEW_TYPST=1
fi
if [[ ! -f "$ROOT/dist/index.html" ]]; then
  if [[ "$SCAFFOLD" != "YES" ]]; then
    echo "MESH_LAN_QA_BLOCKED: missing frontend dist; opt in to synthetic scaffold" >&2
    exit 2
  fi
  if [[ ! -d "$ROOT/dist" ]]; then
    mkdir -- "$ROOT/dist"
    NEW_DIST=1
  fi
  printf '<!doctype html><title>KatoSync synthetic QA</title>\n' > "$ROOT/dist/index.html"
  NEW_INDEX=1
fi
# The built-in Rust test rejects public, loopback, wrong IPs, unknown roles,
# privileged ports, and self-connections; synthetic fixture keys ONLY.
echo "MESH_LAN_QA_SYNTHETIC_ONLY: $ROLE"
cargo test \
  --manifest-path "$ROOT/src-tauri/Cargo.toml" \
  --features katoos-auth-qa \
  --lib mesh_transport::tests::manual_two_host_private_lan_pinned_tls_probe \
  -- --ignored --exact --nocapture
