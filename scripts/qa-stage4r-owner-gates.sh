#!/usr/bin/env bash
# Created by NMKato Solutions – fail closed, no DB change, no outbound requests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export STAGE4R_SOURCE_ROOT="$ROOT"
python3 - <<'PY'
from pathlib import Path
import os
root=Path(os.environ["STAGE4R_SOURCE_ROOT"])
routes={
    "mesh_inbox.rs":("mesh-inbox-send-qa","KATOSYNC_MESH_INBOX_SEND_QA"),
    "mesh_inbox_receiver.rs":("mesh-inbox-receive-qa","KATOSYNC_MESH_INBOX_RECEIVE_QA"),
    "mesh_relay_client.rs":("mesh-pairing-relay-qa","KATOSYNC_MESH_PAIRING_RELAY_QA"),
}
for name,(endpoint,guard) in routes.items():
    code=(root/"src-tauri/src"/name).read_text()
    assert "/functions/v1/"+endpoint in code, "wrong QA route "+name
    assert guard in code, "missing native guard "+name
    assert '/functions/v1/'+endpoint.removesuffix('-qa')+'"' not in code, "unsafe default route "+name
ui=(root/"src/components/MeshConnectionCard.tsx").read_text()
for gate in ("VITE_MESH_INBOX_SEND_QA","VITE_MESH_INBOX_RECEIVE_QA","VITE_MESH_RELAY_QA"):
    assert gate in ui,"missing UI guard "+gate
assert "mesh.recipient.accept" in ui
assert "mesh.recipient.notConnected" in ui
assert "remoteJobsEnabled:false" in ui
print("STAGE4R_OWNER_PAIRING_QA_ONLY_CONTRACT_PASS")
PY
node --experimental-strip-types --test "$ROOT/tests/meshStage4QHonestPairingUx.test.ts" > /dev/null
echo STAGE4R_QA_SOURCE_AND_TRANSLATIONS_PASS
