#!/usr/bin/env bash
# Stage 3Z: local, read-only verification of an installed Stage3X QA bundle.
# Never opens Keychain, alters Gatekeeper, signs apps, starts agents or calls cloud.
set -euo pipefail
[[ "$(uname -s)" == "Darwin" && "$#" -le 1 ]] || {
 echo "STAGE3Z_VERIFY_DENIED_UNSUPPORTED_ARGS" >&2;exit 2;
}
APP="$HOME/Applications/KatoSync Mesh QA Stage3X.app"
BASE="$HOME/Applications/KatoSync Mesh QA Stage2I.app"
EXPECTED="${1:-}"
BUNDLE_ID="com.nmkato.katosync.meshqa.stage3x"
TEAM_ID="T8SB89JPX7"
if [[ ! -d "$APP" || -L "$APP" || ! -d "$BASE" || -L "$BASE" ]]; then
 echo "STAGE3Z_APP_MISSING_OR_SYMLINK" >&2;exit 2;
fi
if [[ -n "$EXPECTED" && ! "$EXPECTED" =~ ^[0-9a-f]{64}$ ]]; then
 echo "STAGE3Z_BAD_EXPECTED_SHA" >&2;exit 2;
fi
codesign --verify --deep --strict "$BASE" >/dev/null
codesign --verify --deep --strict "$APP" >/dev/null || {
 echo "STAGE3Z_BAD_APP_SIGNATURE" >&2;exit 3;
}
ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
[[ "$ID" == "$BUNDLE_ID" ]] || { echo "STAGE3Z_WRONG_BUNDLE_ID" >&2;exit 3; }
INFO="$(codesign -dv --verbose=4 "$APP" 2>&1)" || exit 3
[[ "$INFO" == *"TeamIdentifier=$TEAM_ID"* ]] || {
 echo "STAGE3Z_WRONG_SIGNING_TEAM" >&2;exit 3;
}
[[ "$INFO" == *"Authority=Developer ID Application: MK Heartbeat UG"* ]] || {
 echo "STAGE3Z_WRONG_SIGNING_AUTHORITY" >&2;exit 3;
}
BIN="$APP/Contents/MacOS/katosync"
[[ -f "$BIN" && -x "$BIN" ]] || { echo "STAGE3Z_NATIVE_EXECUTABLE_MISSING" >&2;exit 3; }
SHA="$(/usr/bin/shasum -a 256 "$BIN" | /usr/bin/awk '{print $1}')"
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || exit 4
if [[ -n "$EXPECTED" && "$SHA" != "$EXPECTED" ]]; then
 echo "STAGE3Z_M3_BINARY_HASH_MISMATCH" >&2;exit 4;
fi
echo "STAGE3Z_SIGNED_APP_VERIFIED"
echo "STAGE3Z_TEAM_ID: $TEAM_ID"
echo "STAGE3Z_BUNDLE_ID: $BUNDLE_ID"
echo "STAGE3Z_BINARY_SHA256: $SHA"
if /usr/sbin/spctl --assess --type execute "$APP" >/dev/null 2>&1; then
 echo "STAGE3Z_GATEKEEPER_ASSESSMENT_ACCEPTED"
else
 echo "STAGE3Z_GATEKEEPER_ASSESSMENT_REJECTED"
 echo "STAGE3Z_APP_LAUNCH_NOT_APPROVED" >&2
 exit 5
fi
echo "STAGE3Z_CODE_INTEGRITY_LOCAL_ONLY_NO_LOGIN_OR_PAIRING"
