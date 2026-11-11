#!/usr/bin/env bash
# Created by NMKato Solutions. Only sign an already compiled isolated QA binary.
set -Eeuo pipefail
umask 077
[[ "$(/usr/bin/uname -s)" == "Darwin" && "$(/usr/bin/uname -m)" == "arm64" ]] || exit 2
[[ "$#" == 0 && "$KATOSYNC_STAGE4R_SIGN_QA_ONLY" == "YES_NOTARIZE_BEFORE_USE" ]] || exit 2
BASE="$HOME/Applications/.KatoSync-Mesh-Stage4P-BlackDockQA/KatoSync Stage4P Black Dock QA.app"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$HOME/Projects/KatoSync/src-tauri/target/debug/katosync"
DEST="$HOME/Applications/.KatoSync-Mesh-Stage4R-PairingQA"
SIGN="Developer ID Application: MK Heartbeat UG (haftungsbeschraenkt) (T8SB89JPX7)"
test -d "$BASE" && test -x "$BIN" && test ! -e "$DEST" && test -d "$ROOT"
[[ "$KATOSYNC_STAGE4R_SOURCE_SHA" =~ ^[0-9a-f]{40}$ &&
   "$KATOSYNC_STAGE4R_BINARY_SHA256" =~ ^[0-9a-f]{64}$ ]] || {
 echo "STAGE4R_PINNED_SOURCE_AND_BINARY_REQUIRED";exit 3;
}
test "$(git -C "$ROOT" rev-parse HEAD)" = "$KATOSYNC_STAGE4R_SOURCE_SHA"
test "$(/usr/bin/shasum -a 256 "$BIN"|/usr/bin/awk '{print $1}')" = "$KATOSYNC_STAGE4R_BINARY_SHA256"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$BASE/Contents/Info.plist")" = com.nmkato.katosync.meshqa.stage4j-isolated
codesign --verify --deep --strict "$BASE"
xcrun stapler validate "$BASE" >/dev/null
python3 - "$BIN" <<'PY'
from pathlib import Path
import sys
f=Path(sys.argv[1])
assert f.is_file() and f.stat().st_size>15_000_000
# App must hold native QR routing. Not just JavaScript UI labels.
content=f.read_bytes()
for route in (b'/functions/v1/mesh-inbox-send-qa',
              b'/functions/v1/mesh-inbox-receive-qa',
              b'/functions/v1/mesh-pairing-relay-qa'):
    assert route in content, 'MISSING_COMPILED_QA_ROUTE'
print('STAGE4R_COMPILED_NATIVE_QA_ROUTES_PASS')
PY
test "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" = qa/stage4r-pairing-integration-20261111
tmp="$(/usr/bin/mktemp -d "$HOME/Applications/.KatoSync-Stage4R-Sign.XXXXXX")"
ent="$(/usr/bin/mktemp /tmp/katosync-stage4r-entitlements.XXXXXX)"
trap '/bin/rm -f "$ent"' EXIT
app="$tmp/KatoSync Stage4R Pairing QA.app"
/usr/bin/ditto "$BASE" "$app"
codesign -d --entitlements :- "$BASE" > "$ent" 2>/dev/null
plutil -lint "$ent" >/dev/null
/bin/cp "$BIN" "$app/Contents/MacOS/katosync"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName KatoSync Stage4R Pairing QA" "$app/Contents/Info.plist"
codesign --force --deep --timestamp --options runtime --entitlements "$ent" --sign "$SIGN" "$app" >/dev/null
codesign --verify --deep --strict "$app"
test "$(/usr/bin/shasum -a 256 "$BASE/Contents/Resources/icon.icns"|/usr/bin/awk '{print $1}')" = "$(/usr/bin/shasum -a 256 "$app/Contents/Resources/icon.icns"|/usr/bin/awk '{print $1}')"
/bin/mkdir -m 700 "$DEST"
/bin/mv "$app" "$DEST/KatoSync Stage4R Pairing QA.app"
/bin/rmdir "$tmp"
codesign --verify --deep --strict "$DEST/KatoSync Stage4R Pairing QA.app"
echo STAGE4R_SIGNED_BUT_NOT_NOTARIZED_NOT_STARTED
/usr/bin/shasum -a 256 "$DEST/KatoSync Stage4R Pairing QA.app/Contents/MacOS/katosync"
/usr/bin/shasum -a 256 "$DEST/KatoSync Stage4R Pairing QA.app/Contents/Resources/icon.icns"
