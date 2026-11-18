#!/bin/sh
# NMKato Solutions – emergency QA issuer kill switch.
# Explicit operator action only; never run from the WebView/CI.
set -eu
if [ "$#" -ne 2 ]; then
  echo "QA_ISSUER_DISABLE_REQUIRES_EXPLICIT_CONFIRMATION" >&2
  exit 1
fi
if [ "$1" != "--confirm-disable-qa" ]; then
  echo "QA_ISSUER_DISABLE_REQUIRES_EXPLICIT_CONFIRMATION" >&2
  exit 1
fi
if [ "$2" != "xbnnlyyxiilklsygxcof" ]; then
  echo "QA_ISSUER_DISABLE_PROJECT_MISMATCH" >&2
  exit 1
fi
# Do not delete the private secret here: disabling the stage immediately
# stops future issuance without silently rotating a pinned public key.
supabase secrets unset \
  --project-ref xbnnlyyxiilklsygxcof \
  KATOSYNC_FEATURE_APPROVAL_STAGE >/dev/null
echo "QA_ISSUER_STAGE_DISABLE_REQUESTED"
echo "VERIFY_EDGE_DENIAL_AND_NO_ACTIVE_OWNER_GRANTS"
