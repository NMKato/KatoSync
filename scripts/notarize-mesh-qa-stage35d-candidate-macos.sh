#!/usr/bin/env bash
# KatoSync 3.5d: Apple notarization of signed QA upgrade candidate only.
set -euo pipefail
umask 077
[[ "$(uname -s)" == Darwin && "$#" == 0 ]] || exit 2
[[ "${KATOSYNC_STAGE35_APPLE_UPLOAD_APPROVED:-}" == "YES_EXPLICIT_APPLE_SUBMISSION" ]] || {
  echo "APPLE_SUBMISSION_EXPLICIT_APPROVAL_REQUIRED";exit 2;
}
PROFILE="${KATOSYNC_STAGE35_NOTARY_PROFILE:-}"
[[ "$PROFILE" =~ ^[A-Za-z0-9_.-]{1,64}$ ]] || { echo "NOTARY_PROFILE_REQUIRED";exit 2; }
APP="$HOME/Applications/.KatoSync-Mesh-Stage35d-Candidate/KatoSync Mesh QA Stage35.app"
[[ -d "$APP" && ! -L "$APP" ]] || exit 2
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" == "com.nmkato.katosync.meshqa.stage35" ]] || exit 3
codesign --verify --deep --strict "$APP"
HELPER="$APP/Contents/Resources/resources/stt/KatoSyncSpeechHelper.app"
codesign --verify --strict "$HELPER"
SIGNATURE="$(codesign -dv --verbose=4 "$APP" 2>&1)"
[[ "$SIGNATURE" == *"TeamIdentifier=T8SB89JPX7"* && "$SIGNATURE" == *"Timestamp="* && "$SIGNATURE" == *"flags=0x10000(runtime)"* ]] || exit 4
TMP="$(mktemp -d /tmp/katosync-stage35d-notary.XXXXXX)"
cleanup(){ [[ "$TMP" == /tmp/katosync-stage35d-notary.* ]] && rm -rf -- "$TMP"; }
trap cleanup EXIT INT TERM
ARCHIVE="$TMP/KatoSync-Mesh-QA-Stage35d.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ARCHIVE"
test -s "$ARCHIVE"
echo "STAGE35D_APPLE_SUBMISSION"
xcrun notarytool submit "$ARCHIVE" --keychain-profile "$PROFILE" --wait --output-format json > "$TMP/result.json"
python3 - "$TMP/result.json" <<'PY'
import json,sys
data=json.load(open(sys.argv[1],encoding="utf-8"))
if data.get("status")!="Accepted":
    print("STAGE35D_NOTARIZATION_NOT_ACCEPTED",file=sys.stderr)
    sys.exit(5)
print("STAGE35D_NOTARY_ACCEPTED")
PY
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
codesign --verify --deep --strict "$APP"
spctl --assess --type execute "$APP"
echo "STAGE35D_NOTARIZED_GATEKEEPER_ACCEPTED"
