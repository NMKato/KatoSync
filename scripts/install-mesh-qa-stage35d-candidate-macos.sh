#!/usr/bin/env bash
# KatoSync 3.5d: controlled local QA update with rollback, no Keychain migration.
set -euo pipefail
umask 077
[[ "$(uname -s)" == "Darwin" && "$#" == 0 ]] || exit 2
APP="$HOME/Applications/KatoSync Mesh QA Stage35.app"
CAND="$HOME/Applications/.KatoSync-Mesh-Stage35d-Candidate/KatoSync Mesh QA Stage35.app"
BACKUP="$HOME/Applications/.KatoSync-Mesh-Stage35-Pre35d-20261104.app"
ID="com.nmkato.katosync.meshqa.stage35"
[[ -d "$APP" && -d "$CAND" && ! -e "$BACKUP" && ! -L "$CAND" ]] || {
 echo "STAGE35D_INSTALL_PRECONDITION_FAILED";exit 2;
}
for path in "$APP" "$CAND"; do
 [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$path/Contents/Info.plist")" == "$ID" ]] || exit 3
 codesign --verify --deep --strict "$path"
 xcrun stapler validate "$path" >/dev/null
 spctl --assess --type execute "$path" >/dev/null
done
# Close only the isolated QA bundle; never touch Stable or Stage3X.
osascript -e 'tell application id "com.nmkato.katosync.meshqa.stage35" to quit' >/dev/null 2>&1 || true
for i in 1 2 3 4 5 6 7 8; do
 if ! pgrep -fl '/KatoSync Mesh QA Stage35.app/Contents/MacOS/katosync' | grep -q '/Contents/MacOS/katosync'; then break; fi
 sleep 1
done
if pgrep -fl '/KatoSync Mesh QA Stage35.app/Contents/MacOS/katosync' | grep -q '/Contents/MacOS/katosync'; then
 echo "STAGE35D_QA_APP_STILL_RUNNING";exit 4;
fi
mv "$APP" "$BACKUP"
if ! mv "$CAND" "$APP"; then
 mv "$BACKUP" "$APP"
 echo "STAGE35D_CANDIDATE_MOVE_FAILED_ROLLED_BACK";exit 5;
fi
if ! codesign --verify --deep --strict "$APP" ||
   ! xcrun stapler validate "$APP" >/dev/null ||
   ! spctl --assess --type execute "$APP" >/dev/null; then
 mv "$APP" "$CAND" || true
 mv "$BACKUP" "$APP"
 echo "STAGE35D_VERIFICATION_FAILED_ROLLED_BACK";exit 6;
fi
echo "STAGE35D_UPGRADE_VERIFIED_BACKUP_PRESERVED"
shasum -a 256 "$APP/Contents/MacOS/katosync"
open -na "$APP"
echo "STAGE35D_UPGRADE_LAUNCHED"
