#!/usr/bin/env bash
# NMKato Solutions – isolierter KatoSync-Mesh-QA-Build.
# MARK: Voraussetzungen: macOS, bestehendes signiertes QA-App-Bundle,
# passende Developer-ID, eigenes QA-Konto; niemals die Stable-App ersetzen.
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "MESH_QA_MACOS_REQUIRED" >&2; exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_APP="${KATOSYNC_QA_BASE_APP:-$HOME/Applications/KatoSync Mesh QA.app}"
OUTPUT_APP="${KATOSYNC_QA_OUTPUT_APP:-$HOME/Applications/KatoSync Mesh QA Stage2I.app}"
SIGN_ID="${KATOSYNC_QA_SIGNING_IDENTITY:-}"
TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}"
if [[ ! -d "$SOURCE_APP" || -z "$SIGN_ID" || -e "$OUTPUT_APP" ]]; then
  echo "MESH_QA_BASE_SIGN_OR_OUTPUT_PRECONDITION_FAILED" >&2; exit 2
fi
if [[ ! -e "$ROOT/src-tauri/resources/poppler" ||
      ! -e "$ROOT/src-tauri/resources/typst" ||
      ! -e "$ROOT/src-tauri/resources/stt" ]]; then
  echo "MESH_QA_RESOURCES_MISSING" >&2; exit 2
fi
ENTITLEMENTS="$(mktemp /tmp/katosync-mesh-qa-ent.XXXXXX.plist)"
cleanup(){ rm -f "$ENTITLEMENTS"; }
trap cleanup EXIT
# MARK: Das UI muss den expliziten KATOOS-Auth-QA-Modus mitbauen.
cd "$ROOT"
VITE_KATOOS_AUTH_QA=1 npm run build
VITE_KATOOS_AUTH_QA=1 npm exec tauri -- build --debug --no-bundle \
  --config src-tauri/tauri.mesh-qa.conf.json --features katoos-auth-qa
BIN="$TARGET_DIR/debug/katosync"
if [[ ! -x "$BIN" ]]; then echo "MESH_QA_BINARY_MISSING" >&2;exit 2;fi
# MARK: Bestehende QA-Signatur und Entitlements erhalten, Stable unangetastet.
ditto "$SOURCE_APP" "$OUTPUT_APP"
cp "$BIN" "$OUTPUT_APP/Contents/MacOS/katosync"
codesign -d --entitlements :- "$SOURCE_APP" > "$ENTITLEMENTS" 2>/dev/null
plutil -lint "$ENTITLEMENTS" >/dev/null
codesign --force --deep --timestamp=none --options runtime \
  --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID" "$OUTPUT_APP"
codesign --verify --deep --strict "$OUTPUT_APP"
IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$OUTPUT_APP/Contents/Info.plist")"
if [[ "$IDENTIFIER" != "com.nmkato.katosync.meshqa" ]]; then
  echo "MESH_QA_NOT_ISOLATED" >&2; exit 3
fi
echo "MESH_QA_SIGNED_AND_VERIFIED: $OUTPUT_APP"
shasum -a 256 "$OUTPUT_APP/Contents/MacOS/katosync"
