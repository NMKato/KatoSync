#!/usr/bin/env bash
# Stage 3Z. Explicitly authorized Apple notarization after signed Stage3X exists.
# Never reads, prints or exports Apple account secrets. Credentials stay in Keychain.
set -euo pipefail
umask 077
[[ "$(uname -s)" == "Darwin" && "$#" -eq 0 ]] || {
 echo "STAGE3Z_NOTARY_UNSUPPORTED_ARGS" >&2;exit 2;
}
[[ "${KATOSYNC_STAGE3Z_APPLE_UPLOAD_APPROVED:-}" == "YES_EXPLICIT_APPLE_SUBMISSION" ]] || {
 echo "STAGE3Z_APPLE_SUBMISSION_NOT_AUTHORIZED" >&2;exit 2;
}
PROFILE="${KATOSYNC_STAGE3Z_NOTARY_PROFILE:-}"
[[ "$PROFILE" =~ ^[A-Za-z0-9_.-]{1,64}$ ]] || {
 echo "STAGE3Z_NOTARY_KEYCHAIN_PROFILE_REQUIRED" >&2;exit 2;
}
APP="$HOME/Applications/KatoSync Mesh QA Stage3X.app"
[[ -d "$APP" && ! -L "$APP" ]] || {
 echo "STAGE3Z_SIGNED_APP_MISSING" >&2;exit 2;
}
ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
[[ "$ID" == "com.nmkato.katosync.meshqa.stage3x" ]] || exit 3
codesign --verify --deep --strict "$APP"
META="$(codesign -dv --verbose=4 "$APP" 2>&1)" || exit 3
[[ "$META" == *"TeamIdentifier=T8SB89JPX7"* ]] || exit 3
[[ "$META" == *"Authority=Developer ID Application: MK Heartbeat UG"* ]] || exit 3
[[ "$META" == *"Timestamp="* ]] || {
 echo "STAGE3Z_NOTARY_SECURE_TIMESTAMP_REQUIRED" >&2;exit 3;
}
TEMP="$(mktemp -d /tmp/ksstage3z.XXXXXX)"
[[ "$TEMP" =~ ^/tmp/ksstage3z\.[A-Za-z0-9]{6}$ ]] || exit 3
cleanup(){ [[ "$TEMP" =~ ^/tmp/ksstage3z\.[A-Za-z0-9]{6}$ ]] && /bin/rm -rf -- "$TEMP"; }
trap cleanup EXIT INT TERM
ARCHIVE="$TEMP/KatoSync-Mesh-QA-Stage3X.zip"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP" "$ARCHIVE"
test -s "$ARCHIVE"
echo "STAGE3Z_APPLE_NOTARY_SUBMISSION_STARTED"
# Credentials are read from an existing Apple notarytool Keychain profile only.
xcrun notarytool submit "$ARCHIVE" --keychain-profile "$PROFILE" --wait --output-format json > "$TEMP/notary.json"
python3 - "$TEMP/notary.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1],encoding="utf8"))
if v.get("status")!="Accepted":
 print("STAGE3Z_APPLE_NOTARY_NOT_ACCEPTED",file=sys.stderr)
 sys.exit(4)
print("STAGE3Z_APPLE_NOTARY_ACCEPTED")
PY
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
codesign --verify --deep --strict "$APP"
/usr/sbin/spctl --assess --type execute "$APP" >/dev/null || {
 echo "STAGE3Z_GATEKEEPER_NOT_ACCEPTED_AFTER_STAPLING" >&2;exit 5;
}
echo "STAGE3Z_APP_NOTARIZED_AND_GATEKEEPER_ACCEPTED"
