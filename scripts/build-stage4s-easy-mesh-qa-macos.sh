#!/usr/bin/env bash
# Created by NMKato Solutions
# Stage4S: isolated source build only. No install, launch, auth writes or deploy.
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$(/usr/bin/uname -s)" == "Darwin" && "$(/usr/bin/uname -m)" == "arm64" ]] || exit 2
[[ "$KATOSYNC_STAGE4S_OWNER_QA_ONLY" == "YES_HUMAN_CONFIRM_NO_REMOTE" ]] || {
 echo "STAGE4S_EXPLICIT_OWNER_QA_GATE_REQUIRED";exit 2;
}
[[ "$KATOSYNC_STAGE4S_EXPECT_SOURCE_SHA" =~ ^[a-f0-9]{40}$ &&
   "$(git -C "$ROOT" rev-parse HEAD)" == "$KATOSYNC_STAGE4S_EXPECT_SOURCE_SHA" ]] || {
 echo "STAGE4S_SOURCE_SHA_DRIFT";exit 3;
}
[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]] || {
 echo "STAGE4S_TRACKED_SOURCE_DIRTY";exit 3;
}
[[ -x "$ROOT/node_modules/.bin/tauri" &&
   -s "$ROOT/src-tauri/release-resources.lock.json" &&
   -d "$ROOT/src-tauri/resources/licenses" &&
   -x "$ROOT/src-tauri/resources/typst/typst" ]] || {
 echo "STAGE4S_RELEASE_RESOURCES_MISSING";exit 4;
}
available="$(df -k "$HOME"|tail -1|awk '{print $4}')"
[[ "$available" =~ ^[0-9]+$ && "$available" -gt 9437184 ]] || {
 echo "STAGE4S_INSUFFICIENT_DISK";exit 4;
}
export CARGO_TARGET_DIR="$HOME/Projects/KatoSync/src-tauri/target"
export VITE_KATOOS_AUTH_QA=1
export VITE_MESH_INBOX_SEND_QA=1
export VITE_MESH_INBOX_RECEIVE_QA=1
export VITE_MESH_RELAY_QA=1
export VITE_MESH_EASY_PAIR_QA=1
# Heartbeat is authorized only AFTER explicit device discovery/enrollment.
export VITE_STAGE35_HEARTBEAT_QA=1
export VITE_STAGE35_AUTO_RESUME_QA=0
export KATOSYNC_MESH_INBOX_SEND_QA=1
export KATOSYNC_MESH_INBOX_RECEIVE_QA=1
export KATOSYNC_MESH_PAIRING_RELAY_QA=1
cd "$ROOT"
bash scripts/qa-stage4r-owner-gates.sh
bash scripts/qa-stage4s-easy-mesh-pair.sh >/dev/null
node scripts/qa-stage4j-macos-resource-audit.mjs
npm run build
npm exec -- tauri build --debug --no-bundle  --config src-tauri/tauri.mesh-qa-stage4j.conf.json  --features stage4j-qa
exe="$CARGO_TARGET_DIR/debug/katosync"
[[ -x "$exe" ]] || { echo "STAGE4S_NATIVE_EXECUTABLE_MISSING";exit 4; }
python3 - "$exe" <<'PY_VERIFY'
from pathlib import Path
import sys
exe=Path(sys.argv[1])
data=exe.read_bytes()
assert len(data)>15_000_000
for route in (b'/functions/v1/mesh-inbox-send-qa',
              b'/functions/v1/mesh-inbox-receive-qa',
              b'/functions/v1/mesh-pairing-relay-qa'):
 assert route in data, 'STAGE4S_NATIVE_QA_ENDPOINT_MISSING'
assert data.find(b'local-control-daemon')>0
print('STAGE4S_COMPILED_NATIVE_QA_ENDPOINTS_PASS')
PY_VERIFY
echo STAGE4S_SOURCE_AND_NATIVE_BUILD_SUCCESS
/usr/bin/shasum -a 256 "$exe"
