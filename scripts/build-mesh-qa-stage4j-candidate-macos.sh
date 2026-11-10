#!/usr/bin/env bash
# NMKato Solutions — separate, non-installing, Developer ID signed Stage4J QA.
# NO Apple notarization/upload, NO overwriting existing Stage35, NO K2S calls.
set -euo pipefail
umask 077
[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" && "$#" == 0 ]] || exit 2
[[ "${KATOSYNC_STAGE4J_LOCAL_CANDIDATE_APPROVED:-}" == "YES_ISOLATED_QA_ONLY" ]] || {
 echo "STAGE4J_EXPLICIT_ISOLATED_QA_GATE_REQUIRED";exit 2;
}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="${KATOSYNC_STAGE4J_EXPECT_SHA:-}"
[[ "$REF" =~ ^[a-f0-9]{40}$ && "$(git -C "$ROOT" rev-parse HEAD)" == "$REF" ]] || {
 echo "STAGE4J_SOURCE_SHA_NOT_PINNED";exit 2;
}
BASE="$HOME/Applications/KatoSync Mesh QA Stage35.app"
OUTDIR="$HOME/Applications/.KatoSync-Mesh-Stage4J-Isolated-Candidate"
# The original notarized binary remains immutable. Opt-in to a collision-free QA slot.
if [[ "${KATOSYNC_STAGE4J_QA_SLOT:-}" == "SINGLETON_20261110" ]]; then
 OUTDIR="$HOME/Applications/.KatoSync-Mesh-Stage4J-SingletonQA"
elif [[ "${KATOSYNC_STAGE4J_QA_SLOT:-}" == "SINGLETON_FIX_20261110" ]]; then
 OUTDIR="$HOME/Applications/.KatoSync-Mesh-Stage4J-SingletonFixedQA"
elif [[ "${KATOSYNC_STAGE4J_QA_SLOT:-}" == "MODEL_GUARD_20261110" ]]; then
 OUTDIR="$HOME/Applications/.KatoSync-Mesh-Stage4J-ModelGuardQA"
elif [[ "${KATOSYNC_STAGE4J_QA_SLOT:-}" == "READINESS_20261110" ]]; then
 # Stage4M source QA: never overwrite any already-installed Stage4J slot.
 OUTDIR="$HOME/Applications/.KatoSync-Mesh-Stage4M-ReadinessQA"
elif [[ -n "${KATOSYNC_STAGE4J_QA_SLOT:-}" ]]; then
 echo "STAGE4J_UNKNOWN_QA_SLOT";exit 2
fi
OUT="$OUTDIR/KatoSync Mesh QA Stage4J Candidate.app"
TEAM="T8SB89JPX7"
SIGN="Developer ID Application: MK Heartbeat UG (haftungsbeschraenkt) ($TEAM)"
ID="com.nmkato.katosync.meshqa.stage4j-isolated"
TARGET="${CARGO_TARGET_DIR:-$HOME/Projects/KatoSync/src-tauri/target}"
[[ -d "$BASE" && ! -L "$BASE" && ! -e "$OUT" &&
   ! -L "$OUT" && ! -e "$OUTDIR" &&
   -d "$ROOT/src-tauri/resources" &&
   -x "$ROOT/src-tauri/resources/typst/typst" ]] || {
 echo "STAGE4J_INPUT_OR_OUTPUT_COLLISION";exit 3;
}
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$BASE/Contents/Info.plist")" == "com.nmkato.katosync.meshqa.stage35" ]] || exit 3
codesign --verify --deep --strict "$BASE"
xcrun stapler validate "$BASE" >/dev/null
node "$ROOT/scripts/qa-stage4j-macos-resource-audit.mjs"
[[ -x "$ROOT/node_modules/.bin/tauri" ]] || { echo "STAGE4J_TAURI_MISSING";exit 3; }
STAGING="$(mktemp -d "$HOME/Applications/.KatoSync-Stage4J-Build.XXXXXX")"
ENTITLEMENTS="$(mktemp /tmp/katosync-stage4j-entitlements.XXXXXX.plist)"
cleanup(){
 rm -f -- "$ENTITLEMENTS"
 if [[ "$STAGING" == "$HOME/Applications/.KatoSync-Stage4J-Build."* ]];then
  rm -rf -- "$STAGING"
 fi
}
trap cleanup EXIT
APP="$STAGING/KatoSync Mesh QA Stage4J Candidate.app"
codesign -d --entitlements :- "$BASE" > "$ENTITLEMENTS" 2>/dev/null
plutil -lint "$ENTITLEMENTS" >/dev/null
cd "$ROOT"
VITE_KATOOS_AUTH_QA=1 VITE_STAGE35_AUTO_RESUME_QA=0 VITE_STAGE35_HEARTBEAT_QA=0 npm run build
VITE_KATOOS_AUTH_QA=1 VITE_STAGE35_AUTO_RESUME_QA=0 VITE_STAGE35_HEARTBEAT_QA=0 \
  npm exec -- tauri build --debug --no-bundle \
  --config src-tauri/tauri.mesh-qa-stage4j.conf.json --features stage4j-qa
BIN="$TARGET/debug/katosync"
[[ -x "$BIN" && -s "$BIN" ]] || { echo "STAGE4J_NATIVE_BINARY_MISSING";exit 4; }
python3 "$ROOT/scripts/qa-stage4j-native-namespace-audit.py" "$BIN"
ditto "$BASE" "$APP"
ROOT_RES="$ROOT/src-tauri/resources"
APP_RES="$APP/Contents/Resources/resources"
[[ "$APP_RES" == "$APP/Contents/Resources/resources" ]] || exit 4
for sub in poppler typst stt; do
 rm -rf -- "$APP_RES/$sub"
 ditto "$ROOT_RES/$sub" "$APP_RES/$sub"
done
ditto "$ROOT_RES/licenses" "$APP_RES/licenses"
cp "$BIN" "$APP/Contents/MacOS/katosync"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $ID" "$APP/Contents/Info.plist"
if [[ "${KATOSYNC_STAGE4J_QA_SLOT:-}" == "READINESS_20261110" ]]; then
 /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName KatoSync Stage4M Readiness QA" "$APP/Contents/Info.plist"
elif [[ "${KATOSYNC_STAGE4J_QA_SLOT:-}" == "MODEL_GUARD_20261110" ]]; then
 /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName KatoSync 4J Model Guard QA" "$APP/Contents/Info.plist"
elif [[ "${KATOSYNC_STAGE4J_QA_SLOT:-}" == "SINGLETON_FIX_20261110" ]]; then
 /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName KatoSync 4J Single Instance Fixed QA" "$APP/Contents/Info.plist"
elif [[ "${KATOSYNC_STAGE4J_QA_SLOT:-}" == "SINGLETON_20261110" ]]; then
 /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName KatoSync 4J Single Instance QA" "$APP/Contents/Info.plist"
else
 /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName KatoSync Mesh QA Stage4J Candidate" "$APP/Contents/Info.plist"
fi
test -z "$(find "$APP_RES" -name '.test-only' -print -quit)"
test "$(find "$APP_RES/poppler/libs" -type f -name '*.dylib'|wc -l|tr -d ' ')" -ge 29
for file in "$APP_RES/poppler/libs/"*.dylib;do
 codesign --force --timestamp --options runtime --sign "$SIGN" "$file" >/dev/null
done
for file in "$APP_RES/poppler/pdftotext" "$APP_RES/typst/typst";do
 codesign --force --timestamp --options runtime --sign "$SIGN" "$file" >/dev/null
done
HELPER="$APP_RES/stt/KatoSyncSpeechHelper.app"
codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN" "$HELPER" >/dev/null
codesign --verify --strict "$HELPER"
codesign --force --deep --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN" "$APP" >/dev/null
codesign --verify --deep --strict "$APP"
SIG="$(codesign -dv --verbose=4 "$APP" 2>&1)"
[[ "$SIG" == *"TeamIdentifier=$TEAM"* && "$SIG" == *"Timestamp="* ]] || exit 5
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" == "$ID" ]] || exit 5
"$APP_RES/poppler/pdftotext" -v 2>&1 |grep 'pdftotext version'
"$APP_RES/typst/typst" --version |grep 'typst 0.15.1'
mkdir -m 700 "$OUTDIR"
test ! -e "$OUT"
mv "$APP" "$OUT"
codesign --verify --deep --strict "$OUT"
test -z "$(find "$OUT/Contents/Resources/resources" -name '.test-only' -print -quit)"
echo "STAGE4J_SIGNED_ISOLATED_QA_CANDIDATE_READY"
echo "STAGE4J_DISTINCT_KEYCHAIN_CONFIG_LOGS_LAUNCH_AGENT"
echo "STAGE4J_EXPLICIT_NOT_NOTARIZED_NOT_INSTALLED"
echo "STAGE4J_EXACT_SOURCE_SHA=$REF"
shasum -a 256 "$OUT/Contents/MacOS/katosync"
shasum -a 256 "$OUT/Contents/Resources/resources/typst/typst"
shasum -a 256 "$OUT/Contents/Resources/resources/poppler/pdftotext"
