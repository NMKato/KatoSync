#!/usr/bin/env bash
# NMKato Solutions: disposable one-shot TLS certificate for isolated 2-Mac QA.
# Never enrolls devices or grants remote-execution permissions.
set -euo pipefail
umask 077
if [[ "$(printenv KATOSYNC_MESH_LAN_QA_ALLOW || :)" != "SYNTHETIC_FIXTURES_ONLY" ||
      "$(printenv KATOSYNC_MESH_LAN_QA_ROLE || :)" != "server" ||
      "$(printenv KATOSYNC_MESH_LAN_QA_PORT || :)" != "49331" ]]; then
  echo "MESH_TWO_HOST_BLOCKED: explicit synthetic server opt-in missing" >&2
  exit 2
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
command -v openssl >/dev/null
command -v node >/dev/null
DIR="$(mktemp -d /tmp/ksmesh2u.XXXXXX)"
chmod 700 "$DIR"
cleanup() {
  /bin/rm -f -- "$DIR/key.pem" "$DIR/cert.pem"
  rmdir -- "$DIR" 2>/dev/null || :
}
trap cleanup EXIT INT TERM
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=synthetic-mesh.invalid' \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem" >/dev/null 2>&1
KATOSYNC_MESH_LAN_QA_CERT="$DIR/cert.pem" \
KATOSYNC_MESH_LAN_QA_KEY="$DIR/key.pem" \
node "$SCRIPT_DIR/qa-mesh-two-host-signed-invite.mjs"
