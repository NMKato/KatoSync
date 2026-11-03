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
STAGING="$(mktemp -d "$HOME/Applications/.KatoSync-Mesh-Stage3X.XXXXXX")"
APP="$STAGING/KatoSync Mesh QA Stage3X.app"
cleanup(){ rm -f "$ENTITLEMENTS"; [[ "$STAGING" == "$HOME/Applications/.KatoSync-Mesh-Stage3X."* ]] && rm -rf -- "$STAGING"; }
trap cleanup EXIT
codesign -d --entitlements :- "$BASE" > "$ENTITLEMENTS" 2>/dev/null
plutil -lint "$ENTITLEMENTS" >/dev/null
cd "$ROOT"
VITE_KATOOS_AUTH_QA=1 npm run build
VITE_KATOOS_AUTH_QA=1 npm exec tauri -- build --debug --no-bundle \
  --config src-tauri/tauri.mesh-qa-stage3x.conf.json --features stage3x-qa
BIN="$TARGET/debug/katosync"
[[ -x "$BIN" ]] || { echo "STAGE3X_NATIVE_BINARY_MISSING" >&2;exit 3; }
# Never expose a half-signed app at its final name; publish only after verification.
ditto "$BASE" "$APP"
cp "$BIN" "$APP/Contents/MacOS/katosync"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName KatoSync Mesh QA Stage3X' "$APP/Contents/Info.plist" || true
# Apple notarization validates every executable, including nested helper apps
# located under Resources (not all are discovered by codesign --deep).
HELPER="$APP/Contents/Resources/resources/stt/KatoSyncSpeechHelper.app"
[[ -d "$HELPER" && -x "$HELPER/Contents/MacOS/katosync-stt" ]] || {
 echo "STAGE4A_SIGNED_SPEECH_HELPER_MISSING" >&2; exit 6;
}
codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN" "$HELPER"
codesign --verify --strict "$HELPER"
HELPER_META="$(codesign -dv --verbose=4 "$HELPER" 2>&1)"
[[ "$HELPER_META" == *"TeamIdentifier=T8SB89JPX7"* &&
   "$HELPER_META" == *"Timestamp="* &&
   "$HELPER_META" == *"flags=0x10000(runtime)"* ]] || {
 echo "STAGE4A_SPEECH_HELPER_SIGNING_INVALID" >&2; exit 6;
}
# Sign outer bundle AFTER nested code; an outer signature seals its resources.
codesign --force --deep --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN" "$APP"
codesign --verify --deep --strict "$APP"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" == "$BUNDLE_ID" ]] || exit 4
[[ ! -e "$OUT" ]] || { echo "STAGE3X_TARGET_CREATED_DURING_BUILD" >&2; exit 5; }
mv "$APP" "$OUT"
codesign --verify --deep --strict "$OUT"
echo "STAGE3X_SIGNED_SEPARATE_APP_READY"
shasum -a 256 "$OUT/Contents/MacOS/katosync"
