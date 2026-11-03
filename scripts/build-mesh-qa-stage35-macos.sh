#!/usr/bin/env bash
# NMKato Solutions / Stage3.5. Isolated signed test bundle, never overwrite existing Stage3X.
set -euo pipefail
umask 077
[[ "$(uname -s)" == "Darwin" && "$#" -eq 0 ]] || exit 2
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$HOME/Applications/KatoSync Mesh QA Stage3X.app"
OUT="$HOME/Applications/KatoSync Mesh QA Stage35.app"
SIGN="Developer ID Application: MK Heartbeat UG (haftungsbeschraenkt) (T8SB89JPX7)"
ID="com.nmkato.katosync.meshqa.stage35"
TARGET="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}"
[[ -d "$BASE" && ! -L "$BASE" && ! -e "$OUT" && ! -L "$OUT" ]] || {
 echo "STAGE35_BASE_MISSING_OR_OUTPUT_ALREADY_EXISTS";exit 2;
}
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$BASE/Contents/Info.plist")" == "com.nmkato.katosync.meshqa.stage3x" ]] || exit 2
codesign --verify --deep --strict "$BASE"
[[ -d "$ROOT/node_modules" && -d "$ROOT/dist" &&
    -d "$ROOT/src-tauri/resources/stt/KatoSyncSpeechHelper.app" &&
    -d "$ROOT/src-tauri/resources/poppler" &&
    -d "$ROOT/src-tauri/resources/typst" ]] || {
 echo "STAGE35_BUILD_INPUTS_MISSING";exit 2;
}
ENTITLEMENTS="$(mktemp /tmp/katosync-stage35-entitlements.XXXXXX.plist)"
STAGING="$(mktemp -d "$HOME/Applications/.KatoSync-Mesh-Stage35.XXXXXX")"
APP="$STAGING/KatoSync Mesh QA Stage35.app"
cleanup() {
 rm -f "$ENTITLEMENTS"
 [[ "$STAGING" == "$HOME/Applications/.KatoSync-Mesh-Stage35."* ]] && rm -rf -- "$STAGING"
}
trap cleanup EXIT
codesign -d --entitlements :- "$BASE" > "$ENTITLEMENTS" 2>/dev/null
plutil -lint "$ENTITLEMENTS" >/dev/null
cd "$ROOT"
VITE_KATOOS_AUTH_QA=1 npm run build
VITE_KATOOS_AUTH_QA=1 npm exec -- tauri build --debug --no-bundle \
 --config src-tauri/tauri.mesh-qa-stage35.conf.json --features stage35-qa
BIN="$TARGET/debug/katosync"
[[ -x "$BIN" ]] || { echo "STAGE35_NATIVE_BINARY_MISSING";exit 3; }
ditto "$BASE" "$APP"
cp "$BIN" "$APP/Contents/MacOS/katosync"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $ID" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName KatoSync Mesh QA Stage35' "$APP/Contents/Info.plist" || true
HELPER="$APP/Contents/Resources/resources/stt/KatoSyncSpeechHelper.app"
[[ -d "$HELPER" && -x "$HELPER/Contents/MacOS/katosync-stt" ]] || {
 echo "STAGE35_NESTED_HELPER_MISSING";exit 3;
}
codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN" "$HELPER"
codesign --verify --strict "$HELPER"
codesign --force --deep --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN" "$APP"
codesign --verify --deep --strict "$APP"
META="$(codesign -dv --verbose=4 "$APP" 2>&1)"
[[ "$META" == *"TeamIdentifier=T8SB89JPX7"* && "$META" == *"Timestamp="* ]] || exit 4
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" == "$ID" ]] || exit 4
[[ ! -e "$OUT" ]] || { echo "STAGE35_OUTPUT_CREATED_DURING_BUILD";exit 5; }
mv "$APP" "$OUT"
codesign --verify --deep --strict "$OUT"
echo "STAGE35_SIGNED_SEPARATE_QA_APP_READY"
shasum -a 256 "$OUT/Contents/MacOS/katosync"
echo "STAGE35_NOT_NOTARIZED_YET"
