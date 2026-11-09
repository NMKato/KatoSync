#!/usr/bin/env bash
# NMKato Solutions: opt-in Apple notarization for a separate QA app only.
set -euo pipefail
umask 077
[[ "$(uname -s)" == "Darwin" && "$#" -eq 0 ]] || exit 2
[[ "${KATOSYNC_STAGE35_APPLE_UPLOAD_APPROVED:-}" == "YES_EXPLICIT_APPLE_SUBMISSION" ]] || {
 echo "STAGE35_APPLE_UPLOAD_REQUIRES_EXPLICIT_APPROVAL"; exit 2;
}
PROFILE="${KATOSYNC_STAGE35_NOTARY_PROFILE:-}"
[[ "$PROFILE" =~ ^[A-Za-z0-9_.-]{1,64}$ ]] || {
 echo "STAGE35_KEYCHAIN_NOTARY_PROFILE_REQUIRED"; exit 2;
}
APP="$HOME/Applications/KatoSync Mesh QA Stage35.app"
ID="com.nmkato.katosync.meshqa.stage35"
[[ -d "$APP" && ! -L "$APP" ]] || exit 2
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" == "$ID" ]] || exit 3
codesign --verify --deep --strict "$APP"
SIGNATURE="$(codesign -dv --verbose=4 "$APP" 2>&1)"
[[ "$SIGNATURE" == *"TeamIdentifier=T8SB89JPX7"* && "$SIGNATURE" == *"Timestamp="* ]] || exit 3
HELPER="$APP/Contents/Resources/resources/stt/KatoSyncSpeechHelper.app"
codesign --verify --strict "$HELPER"
HELPER_SIGNATURE="$(codesign -dv --verbose=4 "$HELPER" 2>&1)"
[[ "$HELPER_SIGNATURE" == *"TeamIdentifier=T8SB89JPX7"* &&
   "$HELPER_SIGNATURE" == *"Timestamp="* &&
   "$HELPER_SIGNATURE" == *"flags=0x10000(runtime)"* ]] || exit 4
TEMP="$(mktemp -d /tmp/katosync-stage35-notary.XXXXXX)"
cleanup() {
 [[ "$TEMP" == /tmp/katosync-stage35-notary.* ]] && rm -rf -- "$TEMP"
}
trap cleanup EXIT INT TERM
ARCHIVE="$TEMP/KatoSync-Mesh-QA-Stage35.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ARCHIVE"
test -s "$ARCHIVE"
echo "STAGE35_APPLE_SUBMISSION"
xcrun notarytool submit "$ARCHIVE" --keychain-profile "$PROFILE" --wait --output-format json > "$TEMP/notary-result.json"
python3 - "$TEMP/notary-result.json" <<'PY'
import json,sys
result=json.load(open(sys.argv[1],encoding="utf-8"))
if result.get("status")!="Accepted":
 print("STAGE35_NOTARY_NOT_ACCEPTED",file=sys.stderr)
 sys.exit(5)
print("STAGE35_NOTARY_ACCEPTED")
PY
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
codesign --verify --deep --strict "$APP"
spctl --assess --type execute "$APP" >/dev/null || {
 echo "STAGE35_GATEKEEPER_NOT_ACCEPTED";exit 6;
}
echo "STAGE35_NOTARIZED_GATEKEEPER_ACCEPTED"
