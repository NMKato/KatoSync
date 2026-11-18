#!/usr/bin/env bash
# KatoSync 3.5d: sign a side-by-side upgrade candidate, preserving installed QA app.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OLD="$HOME/Applications/KatoSync Mesh QA Stage35.app"
OUTDIR="$HOME/Applications/.KatoSync-Mesh-Stage35d-Candidate"
OUT="$OUTDIR/KatoSync Mesh QA Stage35.app"
ID="com.nmkato.katosync.meshqa.stage35"
SIGN="Developer ID Application: MK Heartbeat UG (haftungsbeschraenkt) (T8SB89JPX7)"
TARGET="${CARGO_TARGET_DIR:-$HOME/Projects/KatoSync/src-tauri/target}"
[[ "$(uname -s)" == Darwin && "$#" == 0 && -d "$OLD" && ! -e "$OUT" ]] || {
  echo "STAGE35D_PRECONDITION_FAILED";exit 2;
}
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$OLD/Contents/Info.plist")" == "$ID" ]] || exit 2
codesign --verify --deep --strict "$OLD"
xcrun stapler validate "$OLD" >/dev/null
[[ -x "$ROOT/node_modules/.bin/tauri" &&
   -d "$ROOT/src-tauri/resources/stt/KatoSyncSpeechHelper.app" &&
   -d "$ROOT/src-tauri/resources/poppler" &&
   -d "$ROOT/src-tauri/resources/typst" ]] || { echo "STAGE35D_BUILD_INPUTS_MISSING";exit 2; }
mkdir -p "$OUTDIR"
STAGING="$(mktemp -d "$HOME/Applications/.KatoSync-Stage35d-Build.XXXXXX")"
ENTITLEMENTS="$(mktemp /tmp/katosync35d-entitlements.XXXXXX.plist)"
cleanup(){
  rm -f -- "$ENTITLEMENTS"
  [[ "$STAGING" == "$HOME/Applications/.KatoSync-Stage35d-Build."* ]] && rm -rf -- "$STAGING"
}
trap cleanup EXIT
APP="$STAGING/KatoSync Mesh QA Stage35.app"
codesign -d --entitlements :- "$OLD" > "$ENTITLEMENTS" 2>/dev/null
plutil -lint "$ENTITLEMENTS" >/dev/null
cd "$ROOT"
VITE_KATOOS_AUTH_QA=1 VITE_STAGE35_AUTO_RESUME_QA=1 VITE_STAGE35_HEARTBEAT_QA=1 npm run build
VITE_KATOOS_AUTH_QA=1 VITE_STAGE35_AUTO_RESUME_QA=1 VITE_STAGE35_HEARTBEAT_QA=1 npm exec -- tauri build --debug --no-bundle --config src-tauri/tauri.mesh-qa-stage35.conf.json --features stage35-qa
BIN="$TARGET/debug/katosync"
[[ -x "$BIN" && -s "$BIN" ]] || { echo "STAGE35D_NATIVE_BINARY_MISSING";exit 3; }
ditto "$OLD" "$APP"
cp "$BIN" "$APP/Contents/MacOS/katosync"
HELPER="$APP/Contents/Resources/resources/stt/KatoSyncSpeechHelper.app"
[[ -d "$HELPER" && -x "$HELPER/Contents/MacOS/katosync-stt" ]] || exit 3
codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN" "$HELPER"
codesign --verify --strict "$HELPER"
codesign --force --deep --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN" "$APP"
codesign --verify --deep --strict "$APP"
SIGNATURE="$(codesign -dv --verbose=4 "$APP" 2>&1)"
[[ "$SIGNATURE" == *"TeamIdentifier=T8SB89JPX7"* && "$SIGNATURE" == *"Timestamp="* ]] || exit 4
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" == "$ID" ]] || exit 4
[[ ! -e "$OUT" ]] || { echo "STAGE35D_OUTPUT_COLLISION";exit 5; }
mv "$APP" "$OUT"
codesign --verify --deep --strict "$OUT"
echo "STAGE35D_SIGNED_CANDIDATE_READY"
shasum -a 256 "$OUT/Contents/MacOS/katosync"
echo "STAGE35D_NOT_NOTARIZED_YET"
