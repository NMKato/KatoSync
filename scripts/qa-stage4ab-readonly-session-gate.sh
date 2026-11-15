#!/usr/bin/env bash
# Created by NMKato Solutions
# Isolated native Stage4AB session authorization contract QA.
# No network listener, no real owner consent, no project command execution.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v rustc >/dev/null
command -v rustfmt >/dev/null
tmp="$(mktemp -d -t katosync-stage4ab-XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
rustfmt --edition 2021 --check src-tauri/src/mesh_session_gate.rs
rustc --edition=2021 --test \
  src-tauri/src/mesh_session_gate.rs -o "$tmp/read-only-policy-tests"
"$tmp/read-only-policy-tests" --test-threads=1
printf 'STAGE4AB_NATIVE_POLICY_QA_PASS_NO_MESH_NO_JOBS\n'
