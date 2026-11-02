#!/usr/bin/env bash
# NMKato Solutions: separately signed QA variant for explicit KATOOS SSO preflight.
# Does not overwrite stable or Stage2I applications. No cloud deployment.
set -euo pipefail
umask 077
[[ "$(uname -s)" == "Darwin" ]] || { echo "STAGE3X_MAC_REQUIRED" >&2;exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${KATOSYNC_QA_BASE_APP:-$HOME/Applications/KatoSync Mesh QA Stage2I.app}"
OUT="${KATOSYNC_QA_OUTPUT_APP:-$HOME/Applications/KatoSync Mesh QA Stage3X.app}"
SIGN="${KATOSYNC_QA_SIGNING_IDENTITY:-}"
TARGET="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}"
BUNDLE_ID="com.nmkato.katosync.meshqa.stage3x"
[[ -d "$BASE" && -n "$SIGN" && ! -e "$OUT" && "$BASE" != "$OUT" ]] || {
 echo "STAGE3X_SOURCE_SIGN_OR_OUTPUT_PRECONDITION_FAILED" >&2;exit 2;
}
[[ "$OUT" == "$HOME/Applications/KatoSync Mesh QA Stage3X.app" ]] || {
 echo "STAGE3X_UNEXPECTED_OUTPUT_PATH" >&2;exit 2;
}
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$BASE/Contents/Info.plist")" == "com.nmkato.katosync.meshqa" ]] || {
 echo "STAGE3X_BASE_BUNDLE_MISMATCH" >&2;exit 2;
}
codesign --verify --deep --strict "$BASE"
[[ -d "$ROOT/node_modules" && -d "$ROOT/src-tauri/resources/stt" &&
    -d "$ROOT/src-tauri/resources/poppler" && -d "$ROOT/src-tauri/resources/typst" ]] || {
 echo "STAGE3X_BUILD_INPUTS_MISSING" >&2;exit 2;
}
ENTITLEMENTS="$(mktemp /tmp/katosync-mesh-stage3x.XXXXXX.plist)"
cleanup(){ rm -f "$ENTITLEMENTS"; }
trap cleanup EXIT
codesign -d --entitlements :- "$BASE" > "$ENTITLEMENTS" 2>/dev/null
plutil -lint "$ENTITLEMENTS" >/dev/null
cd "$ROOT"
VITE_KATOOS_AUTH_QA=1 npm run build
VITE_KATOOS_AUTH_QA=1 npm exec tauri -- build --debug --no-bundle \
  --config src-tauri/tauri.mesh-qa-stage3x.conf.json --features katoos-auth-qa
BIN="$TARGET/debug/katosync"
[[ -x "$BIN" ]] || { echo "STAGE3X_NATIVE_BINARY_MISSING" >&2;exit 3; }
ditto "$BASE" "$OUT"
cp "$BIN" "$OUT/Contents/MacOS/katosync"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$OUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName KatoSync Mesh QA Stage3X' "$OUT/Contents/Info.plist" || true
codesign --force --deep --timestamp=none --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN" "$OUT"
codesign --verify --deep --strict "$OUT"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$OUT/Contents/Info.plist")" == "$BUNDLE_ID" ]] || exit 4
echo "STAGE3X_SIGNED_SEPARATE_APP_READY"
shasum -a 256 "$OUT/Contents/MacOS/katosync"
