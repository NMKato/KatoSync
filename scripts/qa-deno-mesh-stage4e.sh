#!/usr/bin/env bash
# NMKato Solutions — QA ONLY, no Supabase deployment, no network permissions.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if ! command -v deno >/dev/null 2>&1; then
  echo KATOSYNC_DENO_LOCAL_BINARY_REQUIRED >&2
  exit 2
fi
# Typecheck independently reviewed new code, not the historical SHA-pinned
# Ed25519 handlers (new Deno TS6 BufferSource declaration incompatibility).
deno check --no-config --no-remote \
  supabase/functions/mesh-entitlement-boundary-qa/guard.ts \
  tests/deno/meshEntitlementNativeDenoStage4E.test.ts
# Pure permissionless business-logic tests; DENY NETWORK / FS / ENV by default.
deno test --no-config --no-remote \
  tests/deno/meshEntitlementNativeDenoStage4E.test.ts
# Deno 2 executes the real QA entrypoint module initialization under a
# before-import Deno.serve stub: five default-off endpoints and missing-bearer
# denial. Env permission is ONLY for synthetic test values; NO --allow-net.
# --no-check is required for the legacy pinned handlers' TS6 BufferSource types
# and is not a declaration of Deno production typecheck acceptance.
deno test --no-check --no-config --no-remote \
  --allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,KATOSYNC_MESH_ENTITLEMENT_BOUNDARY_STAGE,KATOSYNC_MESH_INBOX_STAGE,KATOSYNC_MESH_INBOX_RECEIVE_STAGE,KATOSYNC_MESH_PAIRING_RELAY_STAGE,KATOSYNC_MESH_ENROLLMENT_STAGE,KATOSYNC_MESH_RELAY_QA_MODE,KATOSYNC_MESH_RELAY_QA_PROJECT_REF,DENO_DEPLOYMENT_ID \
  tests/deno/meshEntrypointDefaultOffStage4E.test.ts
# NEW, strictly QA-only owner cancellation endpoint: full Deno graph check
# without --no-check, then invoke its actual Deno.serve index under a stub.
# Only synthetic per-test environment keys; NO --allow-net or real credentials.
deno check --no-config --no-remote \
  supabase/functions/mesh-inbox-terminal-owner-qa/index.ts \
  tests/deno/meshTerminalOwnerEntrypointStage4E.test.ts
deno test --no-config --no-remote \
  --allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,KATOSYNC_INBOX_TERMINAL_OWNER_STAGE,KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF \
  tests/deno/meshTerminalOwnerEntrypointStage4E.test.ts
# Independent TS6 shadow compatibility test does NOT touch immutable handlers.
# The Node22 type-strip runtime imports both ORIGINAL and copied QA crypto.
node --experimental-strip-types scripts/qa-deno-ts6-crypto-shadow.mjs
echo KATOSYNC_STAGE4E_NATIVE_DENO_QA_PASS_NO_DEPLOY
