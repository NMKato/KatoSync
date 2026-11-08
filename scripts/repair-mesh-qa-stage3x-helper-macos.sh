#!/usr/bin/env bash
# NMKato Solutions / Stage4A: repair notarization-rejected ad-hoc STT helper
# by re-signing nested code first, then the outer isolated QA app.
# No stable/Stage2I app touched; keep rollback copy until Apple accepts.
set -euo pipefail
umask 077
[[ "$(uname -s)" == "Darwin" && "$#" -eq 0 ]] || exit 2
APP="$HOME/Applications/KatoSync Mesh QA Stage3X.app"
IDENTITY="Developer ID Application: MK Heartbeat UG (haftungsbeschraenkt) (T8SB89JPX7)"
ID="com.nmkato.katosync.meshqa.stage3x"
[[ -d "$APP" && ! -L "$APP" ]] || { echo "STAGE4A_STAGE3X_MISSING"; exit 2; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" == "$ID" ]] || exit 2
codesign --verify --deep --strict "$APP"
OLD_METADATA="$(codesign -dv --verbose=4 "$APP" 2>&1)"
[[ "$OLD_METADATA" == *"TeamIdentifier=T8SB89JPX7"* ]] || exit 3
[[ "$OLD_METADATA" == *"Timestamp="* ]] || exit 3
STAGE="$(mktemp -d "$HOME/Applications/.KatoSync-Mesh-Stage4A.XXXXXX")"
ENTITLEMENTS="$(mktemp /tmp/katosync-stage4a.XXXXXX.plist)"
BACKUP_DIR=""
cleanup() {
 rm -f -- "$ENTITLEMENTS"
 [[ "$STAGE" == "$HOME/Applications/.KatoSync-Mesh-Stage4A."* ]] && rm -rf -- "$STAGE"
}
trap cleanup EXIT
CANDIDATE="$STAGE/KatoSync Mesh QA Stage3X.app"
ditto "$APP" "$CANDIDATE"
codesign -d --entitlements :- "$APP" > "$ENTITLEMENTS" 2>/dev/null
plutil -lint "$ENTITLEMENTS" >/dev/null
HELPER="$CANDIDATE/Contents/Resources/resources/stt/KatoSyncSpeechHelper.app"
[[ -d "$HELPER" && -x "$HELPER/Contents/MacOS/katosync-stt" ]] || exit 3
# Use the microphone entitlement already present in the shipped main application.
codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$HELPER"
codesign --verify --strict "$HELPER"
HELPER_META="$(codesign -dv --verbose=4 "$HELPER" 2>&1)"
[[ "$HELPER_META" == *"TeamIdentifier=T8SB89JPX7"* &&
   "$HELPER_META" == *"Timestamp="* &&
   "$HELPER_META" == *"flags=0x10000(runtime)"* ]] || {
 echo "STAGE4A_HELPER_SIGNING_FAILED" >&2; exit 4;
}
codesign --force --deep --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$CANDIDATE"
codesign --verify --deep --strict "$CANDIDATE"
codesign --verify --strict "$HELPER"
HELPER_META="$(codesign -dv --verbose=4 "$HELPER" 2>&1)"
[[ "$HELPER_META" == *"TeamIdentifier=T8SB89JPX7"* &&
   "$HELPER_META" == *"Timestamp="* &&
   "$HELPER_META" == *"flags=0x10000(runtime)"* ]] || exit 4
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$CANDIDATE/Contents/Info.plist")" == "$ID" ]] || exit 4
# Keep a same-volume rollback copy if any later notarization/stapling fails.
BACKUP_DIR="$(mktemp -d "$HOME/Applications/.KatoSync-Mesh-Stage3X-rollback.XXXXXX")"
BACKUP="$BACKUP_DIR/KatoSync Mesh QA Stage3X.app"
[[ -d "$APP" && ! -L "$APP" ]] || exit 5
mv "$APP" "$BACKUP"
if ! mv "$CANDIDATE" "$APP"; then
 mv "$BACKUP" "$APP"
 echo "STAGE4A_RESTORE_OLD_APP_AFTER_MOVE_FAILURE" >&2
 exit 5
fi
if ! codesign --verify --deep --strict "$APP"; then
 mv "$APP" "$STAGE/failed.app"
 mv "$BACKUP" "$APP"
 echo "STAGE4A_RESTORE_OLD_APP_AFTER_SIGNATURE_FAILURE" >&2
 exit 5
fi
echo "STAGE4A_NESTED_HELPER_AND_PARENT_SIGNED"
echo "STAGE4A_ROLLBACK_BUNDLE: $BACKUP"
echo "STAGE4A_SIGNED_BINARY_SHA256: $(shasum -a 256 "$APP/Contents/MacOS/katosync" | awk '{print $1}')"
echo "STAGE4A_APP_READY_FOR_NOTARIZATION_RETRY"
