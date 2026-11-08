#!/usr/bin/env bash
# NMKato Solutions / Stage 3C. Real native Rust mTLS on TWO named private LAN
# Macs with test-only Ed25519 seeds. No app Keychain / production account access.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_NAME="mesh_transport::tests::manual_two_host_private_lan_pinned_tls_probe"
SOURCE="$ROOT/src-tauri/src/mesh_transport.rs"
die() { echo "MESH_NATIVE_LAN_BLOCKED: $1" >&2; exit 2; }
[[ "$(uname -s)" == "Darwin" ]] || die "MACOS_REQUIRED"
[[ "${KATOSYNC_MESH_LAN_QA_ALLOW:-}" == "SYNTHETIC_FIXTURES_ONLY" ]] ||
  die "SYNTHETIC_OPT_IN_REQUIRED"
[[ "$#" -eq 0 ]] || die "EXTRA_ARGUMENTS_DENIED"
case "${KATOSYNC_MESH_LAN_QA_ROLE:-}" in
 server|client|client-wrong-pin) ;;
 *) die "ROLE_DENIED" ;;
esac
[[ -z "${KATOSYNC_MESH_LAN_QA_CERT:-}" && -z "${KATOSYNC_MESH_LAN_QA_KEY:-}" ]] ||
  die "REAL_CERT_OR_KEY_ENV_DENIED"
[[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" && -z "${KATOSYNC_MESH_QA_REAL_TOKEN:-}" ]] ||
  die "CLOUD_KEYS_DENIED"
[[ -n "${KATOSYNC_MESH_LAN_QA_ADDRESS:-}" && -n "${KATOSYNC_MESH_LAN_QA_EXPECT_PEER:-}" ]] ||
  die "EXPLICIT_ADDRESSES_REQUIRED"
if [[ "${KATOSYNC_MESH_LAN_QA_ROLE}" == "server" ]]; then
 if [[ "${KATOSYNC_MESH_LAN_QA_NEGATIVE:-}" != "" &&
       "${KATOSYNC_MESH_LAN_QA_NEGATIVE:-}" != "YES" ]]; then
   die "INVALID_NEGATIVE_MODE"
 fi
else
 [[ -z "${KATOSYNC_MESH_LAN_QA_NEGATIVE:-}" ]] || die "CLIENT_NEGATIVE_FLAG_DENIED"
fi
# In addition, the built-in ignored Rust test checks RFC1918, exact peer
# address, unprivileged port, test role, and timeout.
[[ -f "$SOURCE" && -f "$ROOT/src-tauri/Cargo.toml" ]] || die "SOURCES_MISSING"
[[ -f "$ROOT/dist/index.html" ]] || die "FRONTEND_QA_BUILD_REQUIRED"
grep -qF "fn manual_two_host_private_lan_pinned_tls_probe()" "$SOURCE" || die "NATIVE_HARDWARE_TEST_MISSING"
grep -qF 'SYNTHETIC_FIXTURES_ONLY' "$SOURCE" || die "SYNTHETIC_ONLY_GUARD_MISSING"
grep -qF 'let a = signing(41);' "$SOURCE" || die "SYNTHETIC_IDENTITY_CHANGED"
grep -qF 'let b = signing(42);' "$SOURCE" || die "SYNTHETIC_IDENTITY_CHANGED"
grep -qF '#[ignore = "manual two-machine LAN QA: synthetic test keys, explicit one-shot private socket only"]' \
 "$SOURCE" || die "TEST_NOT_IGNORED"
[[ -n "${CARGO_TARGET_DIR:-}" && "${CARGO_TARGET_DIR}" == /* &&
   -d "${CARGO_TARGET_DIR}" ]] || die "EXPLICIT_PREBUILT_TARGET_REQUIRED"
[[ -f "$ROOT/src-tauri/resources/poppler/.test-only" &&
   -f "$ROOT/src-tauri/resources/typst/.test-only" ]] ||
   die "TEMPORARY_RESOURCE_STUBS_REQUIRED"
echo "MESH_NATIVE_LAN_QA_SYNTHETIC_ONLY role=${KATOSYNC_MESH_LAN_QA_ROLE}"
exec cargo test --offline --manifest-path "$ROOT/src-tauri/Cargo.toml" \
 --features katoos-auth-qa --lib "$TEST_NAME" \
 -- --ignored --exact --nocapture --test-threads=1
