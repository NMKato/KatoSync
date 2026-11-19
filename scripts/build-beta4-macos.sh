#!/usr/bin/env bash
# Created by NMKato Solutions
# Build a fresh private-beta candidate. Preserve the existing Stage4J account,
# device identity and fallback bundle. Never install, launch or stop an app.
set -Eeuo pipefail
umask 077

fail() { printf 'BETA4_BUILD_BLOCKED: %s\n' "$1" >&2; exit 2; }
MODE="${1:-build}"
[[ "$#" -le 1 && "$MODE" =~ ^(build|--preflight|--notarize)$ ]] ||
  fail "Usage: build-beta4-macos.sh [--preflight|--notarize]"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] ||
  fail "macOS arm64 is required"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_SHA="${KATOSYNC_BETA_SOURCE_SHA:-}"
BASE_APP="${KATOSYNC_BETA_BASE_APP:-}"
OUTPUT_APP="${KATOSYNC_BETA_OUTPUT_APP:-}"
SIGN_ID="${KATOSYNC_BETA_SIGNING_IDENTITY:-}"
NOTARY_PROFILE="${KATOSYNC_BETA_NOTARY_PROFILE:-}"
TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}"
PREBUILT_DIRECTORY="${KATOSYNC_BETA_PREBUILT_DIRECTORY:-}"
PREBUILT_SHA256=""
BUNDLE_ID="com.nmkato.katosync.meshqa.stage4j-isolated"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "Set KATOSYNC_BETA_SOURCE_SHA to the reviewed commit"
[[ "$BASE_APP" == /*.app && -d "$BASE_APP" && ! -L "$BASE_APP" ]] ||
  fail "Set KATOSYNC_BETA_BASE_APP to the existing notarized Stage4J/Stage4X bundle"
[[ "$OUTPUT_APP" == /*.app && ! -e "$OUTPUT_APP" && ! -L "$OUTPUT_APP" ]] ||
  fail "Set KATOSYNC_BETA_OUTPUT_APP to a new absolute .app path"
[[ -n "$SIGN_ID" && "$SIGN_ID" == "Developer ID Application: "* ]] ||
  fail "Set KATOSYNC_BETA_SIGNING_IDENTITY to the existing Developer ID"
[[ "$TARGET_DIR" == /* && "$TARGET_DIR" != / ]] || fail "CARGO_TARGET_DIR must be an absolute cache path"
[[ "$MODE" != --notarize || -n "$NOTARY_PROFILE" ]] ||
  fail "Set KATOSYNC_BETA_NOTARY_PROFILE to an existing Keychain profile"
for tool in git node npm cargo python3 codesign xcrun ditto plutil unzip shasum; do
  command -v "$tool" >/dev/null || fail "Required build tool is unavailable: $tool"
done
[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$SOURCE_SHA" ]] || fail "Source commit changed"
[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=normal)" ]] ||
  fail "Commit the candidate changes before building"
[[ -x "$ROOT/node_modules/.bin/tauri" ]] || fail "Install the locked npm dependencies first"
[[ -s "$ROOT/src-tauri/release-resources.lock.json" ]] ||
  fail "Prepare the real release resources and their integrity lock"

# Validate paths before any build or output mutation. No existing bundle is edited.
python3 - "$ROOT" "$BASE_APP" "$OUTPUT_APP" "$TARGET_DIR" "$BUNDLE_ID" <<'PY'
from pathlib import Path
import json, plistlib, re, shutil, sys
root, base, out, target = map(Path, sys.argv[1:5])
bundle_id = sys.argv[5]
assert base.resolve() == base, "Base bundle must not resolve through a symlink"
assert out.parent.is_dir() and out.parent.resolve() == out.parent, "Output parent must already exist without symlinks"
assert not out.exists() and not Path(str(out) + ".zip").exists(), "Output already exists"
assert out != base and base not in out.parents, "Output overlaps the fallback"
assert root not in out.parents and out not in root.parents, "Output must be outside the source checkout"
info = plistlib.loads((base / "Contents/Info.plist").read_bytes())
assert info.get("CFBundleIdentifier") == bundle_id, "Fallback identity differs"
assert info.get("CFBundleExecutable") == "katosync", "Unexpected fallback executable"
assert (base / "Contents/Resources/icon.icns").is_file(), "Fallback icon missing"
version = json.loads((root / "package.json").read_text())["version"]
assert re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version), "Expected a semantic application version"
config = json.loads((root / "src-tauri/tauri.beta4.conf.json").read_text())
assert config["identifier"] == bundle_id, "Candidate bundle identity changed"
assert shutil.disk_usage(root).free >= 9 * 2**30, "At least 9 GiB of free build space is required"
assert shutil.disk_usage(out.parent).free >= 1024**3, "At least 1 GiB of free output space is required"
print("BETA4_PATHS_VERSION_AND_STORAGE_PASS")
PY
codesign --verify --deep --strict "$BASE_APP"
xcrun stapler validate "$BASE_APP" >/dev/null
/usr/sbin/spctl --assess --type execute "$BASE_APP"
BASE_SIGNATURE="$(codesign -dv --verbose=4 "$BASE_APP" 2>&1)"
BASE_TEAM="$(printf '%s\n' "$BASE_SIGNATURE" | sed -n 's/^TeamIdentifier=//p')"
[[ "$BASE_TEAM" =~ ^[A-Z0-9]{10}$ && "$SIGN_ID" == *"($BASE_TEAM)" ]] ||
  fail "Signing team must match the accepted fallback"
node "$ROOT/scripts/qa-stage4j-macos-resource-audit.mjs"
if [[ -n "$PREBUILT_DIRECTORY" ]]; then
  # Import only from the separately verified exact GitHub run. This receipt
  # binds source and bytes; it is not a cryptographic build attestation.
  PREBUILT_SHA256="$(python3 "$ROOT/scripts/verify-beta4-prebuilt.py" \
    "$ROOT" "$SOURCE_SHA" "$PREBUILT_DIRECTORY" "$BASE_APP" "$OUTPUT_APP")" ||
    fail "Prebuilt binary verification failed"
  [[ "$PREBUILT_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "Invalid prebuilt verification result"
fi
if [[ "$MODE" == --preflight ]]; then
  printf 'BETA4_PREFLIGHT_PASS source=%s\n' "$SOURCE_SHA"
  exit 0
fi

export CARGO_TARGET_DIR="$TARGET_DIR"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
export VITE_KATOOS_AUTH_QA=1
export VITE_MESH_INBOX_SEND_QA=1
export VITE_MESH_INBOX_RECEIVE_QA=1
export VITE_MESH_RELAY_QA=1
export VITE_MESH_EASY_PAIR_QA=1
export VITE_STAGE4W_LAN_QA=1
export VITE_STAGE35_HEARTBEAT_QA=1
export VITE_STAGE35_AUTO_RESUME_QA=0
export KATOSYNC_MESH_INBOX_SEND_QA=1
export KATOSYNC_MESH_INBOX_RECEIVE_QA=1
export KATOSYNC_MESH_PAIRING_RELAY_QA=1
cd "$ROOT"
if [[ -n "$PREBUILT_DIRECTORY" ]]; then
  BIN="$PREBUILT_DIRECTORY/katosync"
else
  npm run build
  npm exec -- tauri build --debug --no-bundle --config src-tauri/tauri.beta4.conf.json --features stage4j-qa
  BIN="$TARGET_DIR/debug/katosync"
fi
[[ -x "$BIN" ]] || fail "The native build did not produce katosync"
[[ "$(git rev-parse HEAD)" == "$SOURCE_SHA" &&
   -z "$(git status --porcelain --untracked-files=normal)" ]] || fail "Source changed during the build"
python3 scripts/qa-stage4j-native-namespace-audit.py "$BIN"
BUILT_SHA256="$(shasum -a 256 "$BIN" | awk '{print $1}')"
[[ -z "$PREBUILT_DIRECTORY" || "$BUILT_SHA256" == "$PREBUILT_SHA256" ]] ||
  fail "Verified prebuilt binary changed before staging"

STAGING="$(mktemp -d "$(dirname "$OUTPUT_APP")/.katosync-beta4-build.XXXXXX")"
cleanup() {
  if [[ -n "${STAGING:-}" && -d "$STAGING" &&
        "$(basename "$STAGING")" == .katosync-beta4-build.* ]]; then
    rm -rf -- "$STAGING"
  fi
}
trap cleanup EXIT
APP="$STAGING/$(basename "$OUTPUT_APP")"
ENTITLEMENTS="$STAGING/entitlements.plist"
codesign -d --entitlements :- "$BASE_APP" > "$ENTITLEMENTS" 2>/dev/null
plutil -lint "$ENTITLEMENTS" >/dev/null
ditto "$BASE_APP" "$APP"
python3 - "$ROOT" "$APP" "$BIN" "$SOURCE_SHA" "$BUNDLE_ID" "$BUILT_SHA256" <<'PY'
from pathlib import Path
import hashlib, json, plistlib, shutil, sys
root, app, binary = map(Path, sys.argv[1:4])
source_sha, bundle_id, expected_binary = sys.argv[4:7]
resources = app / "Contents/Resources/resources"
assert app.parent.name.startswith(".katosync-beta4-build."), "Not a disposable build directory"
for name in ("poppler", "typst", "stt", "licenses"):
    target = resources / name
    assert not target.is_symlink(), "Unexpected resource symlink"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(root / "src-tauri/resources" / name, target)
shutil.copy2(binary, app / "Contents/MacOS/katosync")
assert hashlib.sha256((app / "Contents/MacOS/katosync").read_bytes()).hexdigest() == expected_binary, "Shared build output changed before staging"
info_path = app / "Contents/Info.plist"
info = plistlib.loads(info_path.read_bytes())
privacy = plistlib.loads((root / "src-tauri/Info.plist").read_bytes())
assert isinstance(privacy.get("NSLocalNetworkUsageDescription"), str) and privacy["NSLocalNetworkUsageDescription"].strip()
assert privacy.get("NSBonjourServices") == ["_katosync-mesh._tcp"]
# Prebuilt candidates inherit the existing signed identity. Carry only the
# reviewed local-network declarations from this exact source into that bundle.
for key in ("NSLocalNetworkUsageDescription", "NSBonjourServices"):
    info[key] = privacy[key]
version = json.loads((root / "package.json").read_text())["version"]
assert info["CFBundleIdentifier"] == bundle_id
info.update(CFBundleName="KatoSync Beta4", CFBundleDisplayName="KatoSync Beta4 Candidate",
            CFBundleShortVersionString=version.split("-", 1)[0], CFBundleVersion=version.split("-", 1)[0], KatoSyncSourceCommit=source_sha)
info_path.write_bytes(plistlib.dumps(info))
lock_hash = hashlib.sha256((root / "src-tauri/release-resources.lock.json").read_bytes()).hexdigest()
proof = {"schemaVersion": 1, "sourceCommit": source_sha, "packageVersion": version,
         "nativeFeature": "stage4j-qa", "bundleIdentifier": bundle_id,
         "resourceLockSha256": lock_hash, "preSignBinarySha256": expected_binary, "candidate": True}
(app / "Contents/Resources/katosync-build.json").write_text(json.dumps(proof, indent=2) + "\n")
print("BETA4_STAGED_EXISTING_IDENTITY_AND_REAL_RESOURCES")
PY
APP_RES="$APP/Contents/Resources/resources"
for library in "$APP_RES/poppler/libs/"*.dylib; do
  codesign --force --timestamp --options runtime --sign "$SIGN_ID" "$library"
done
for binary in "$APP_RES/poppler/pdftotext" "$APP_RES/typst/typst"; do
  codesign --force --timestamp --options runtime --sign "$SIGN_ID" "$binary"
done
codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" \
  --sign "$SIGN_ID" "$APP_RES/stt/KatoSyncSpeechHelper.app"
codesign --force --deep --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID" "$APP"
codesign --verify --deep --strict "$APP"
SIGNATURE="$(codesign -dv --verbose=4 "$APP" 2>&1)"
[[ "$SIGNATURE" == *"TeamIdentifier=$BASE_TEAM"* && "$SIGNATURE" == *"Timestamp="* ]] ||
  fail "Candidate signing identity or timestamp is missing"
[[ ! -e "$OUTPUT_APP" && ! -L "$OUTPUT_APP" ]] || fail "Output appeared while building"
mv "$APP" "$OUTPUT_APP"
ARCHIVE="$OUTPUT_APP.zip"
[[ ! -e "$ARCHIVE" && ! -L "$ARCHIVE" ]] || fail "Archive already exists"
ditto -c -k --keepParent "$OUTPUT_APP" "$ARCHIVE"
unzip -tqq "$ARCHIVE"
printf 'BETA4_SIGNED_CANDIDATE_NOT_STARTED source=%s\n' "$SOURCE_SHA"
shasum -a 256 "$OUTPUT_APP/Contents/MacOS/katosync" "$ARCHIVE"

# Notarization uses an existing local Keychain profile. No credentials are read
# or passed as command arguments. The staged candidate remains available on failure.
if [[ "$MODE" == --notarize ]]; then
  NOTARY_RESULT="$OUTPUT_APP.notary.json"
  [[ ! -e "$NOTARY_RESULT" && ! -L "$NOTARY_RESULT" ]] || fail "Notary receipt already exists"
  xcrun notarytool submit "$ARCHIVE" --keychain-profile "$NOTARY_PROFILE" --wait --output-format json > "$NOTARY_RESULT"
  python3 - "$NOTARY_RESULT" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
assert result.get("status") == "Accepted", "Apple has not accepted this candidate"
print("BETA4_APPLE_NOTARIZATION_ACCEPTED")
PY
  xcrun stapler staple "$OUTPUT_APP"
  xcrun stapler validate "$OUTPUT_APP"
  codesign --verify --deep --strict "$OUTPUT_APP"
  /usr/sbin/spctl --assess --type execute "$OUTPUT_APP"
  # Preserve the exact submitted archive; distribute the separate stapled one.
  STAPLED_ARCHIVE="$OUTPUT_APP.stapled.zip"
  [[ ! -e "$STAPLED_ARCHIVE" && ! -L "$STAPLED_ARCHIVE" ]] || fail "Stapled archive already exists"
  ditto -c -k --keepParent "$OUTPUT_APP" "$STAPLED_ARCHIVE"
  unzip -tqq "$STAPLED_ARCHIVE"
  shasum -a 256 "$STAPLED_ARCHIVE"
  printf 'BETA4_NOTARIZED_CANDIDATE_READY_NOT_STARTED\n'
else
  printf 'BETA4_NOTARIZATION_PENDING_NOT_STARTED\n'
fi
