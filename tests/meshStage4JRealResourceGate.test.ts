// NMKato Solutions — Stage4J: never ship the notarized Stage35 test-only resources.
// These contract checks are platform-neutral: no Apple keys, uploads or local binaries.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const audit=read("scripts/qa-stage4j-macos-resource-audit.mjs");
const build=read("scripts/build-mesh-qa-stage4j-candidate-macos.sh");
const release=read("scripts/check-release-resources.mjs");

test("resource audit uses the release lock and validates full dylib inventory",()=>{
 assert.match(audit,/verifyReleaseResources\(root,"darwin-arm64"\)/);
 assert.match(audit,/lock\.popplerDylibs/);
 assert.match(audit,/LIBRARY_INVENTORY_MISMATCH/);
 assert.match(audit,/LIBRARY_SHA256_MISMATCH/);
 assert.match(audit,/macLibraryDependencies\(binary\)/);
 assert.match(audit,/execFileSync\("otool",\["-L",file\]/);
 assert.match(audit,/NON_BUNDLED_LIBRARY_DEPENDENCY/);
 assert.match(audit,/ABSOLUTE_OR_RPATH_LIBRARY_DEPENDENCY/);
});
test("no Homebrew-specific dynamic dependency is accepted",()=>{
 assert.match(audit,/dependency\.startsWith\("\/usr\/lib\/"\)/);
 assert.match(audit,/dependency\.startsWith\("\/System\/Library\/"\)/);
 assert.doesNotMatch(audit,/dependency\.startsWith\("\/opt\/homebrew\/"\)/);
 assert.match(audit,/realpathSync\(next\)!==next/);
});
test("all license and helper identity checks precede candidate signing",()=>{
 for(const name of ["poppler-COPYING","poppler-COPYING3","typst-LICENSE","typst-NOTICE"])
  assert.ok(audit.includes(name));
 assert.match(audit,/STT_TEAM_IDENTITY_UNVERIFIED/);
 assert.match(audit,/STT_CODE_SIGNATURE_INVALID/);
 assert.match(audit,/TeamIdentifier=T8SB89JPX7/);
 assert.match(build,/node "\$ROOT\/scripts\/qa-stage4j-macos-resource-audit\.mjs"/);
});
test("build is isolated, sha-pinned, authenticated and fail-closed",()=>{
 assert.match(build,/KATOSYNC_STAGE4J_LOCAL_CANDIDATE_APPROVED/);
 assert.match(build,/YES_ISOLATED_QA_ONLY/);
 assert.match(build,/KATOSYNC_STAGE4J_EXPECT_SHA/);
 assert.match(build,/STAGE4J_SOURCE_SHA_NOT_PINNED/);
 assert.match(build,/STAGE4J_INPUT_OR_OUTPUT_COLLISION/);
 assert.match(build,/\.KatoSync-Mesh-Stage4J-Candidate/);
 assert.match(build,/com\.nmkato\.katosync\.meshqa\.stage4j-candidate/);
 assert.match(build,/codesign --verify --deep --strict "\$BASE"/);
 assert.match(build,/xcrun stapler validate "\$BASE"/);
 assert.doesNotMatch(build,/rm -rf.*\$BASE/);
});
test("build verifies resources, signs nested runtime, and cannot silently upload to Apple",()=>{
 assert.match(build,/find "\$APP_RES" -name '\.test-only'/);
 assert.match(build,/for file in "\$APP_RES\/poppler\/libs\/"\*\.dylib/);
 assert.match(build,/codesign --force --timestamp --options runtime --sign "\$SIGN"/);
 assert.match(build,/codesign --verify --deep --strict "\$APP"/);
 assert.match(build,/STAGE4J_EXPLICIT_NOT_NOTARIZED_NOT_INSTALLED/);
 assert.doesNotMatch(build,/notarytool submit|stapler staple|spctl --assess|supabase db push|git push|open -a/);
 assert.match(build,/--features stage35-qa/);
 assert.match(build,/VITE_KATOOS_AUTH_QA=1/);
});
test("the existing release gate continues rejecting all .test-only resources",()=>{
 assert.match(release,/if\(item\.name==="\.test-only"\)/);
 assert.match(release,/RELEASE_RESOURCE_SYMLINK_FORBIDDEN/);
 assert.match(release,/RELEASE_SHA256_MISMATCH/);
 assert.match(release,/RELEASE_LOCK_TARGET_OR_SCHEMA_INVALID/);
});
