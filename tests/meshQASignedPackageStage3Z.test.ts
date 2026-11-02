import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {platform} from "node:os";
const path=new URL("../scripts/verify-mesh-qa-stage3x-macos.sh",import.meta.url);
const code=readFileSync(path,"utf8");
test("Stage3Z verifier has exact bundle/team and source app boundaries",()=>{
 for (const s of ["com.nmkato.katosync.meshqa.stage3x","T8SB89JPX7",
 "KatoSync Mesh QA Stage2I.app","KatoSync Mesh QA Stage3X.app",
 "STAGE3Z_WRONG_SIGNING_TEAM","STAGE3Z_WRONG_SIGNING_AUTHORITY"])assert.ok(code.includes(s),s);
 assert.match(code,/codesign --verify --deep --strict "\$BASE"/);
 assert.match(code,/codesign --verify --deep --strict "\$APP"/);
 assert.match(code,/CFBundleIdentifier/);
});
test("Stage3Z verifier validates digest and exposes Gatekeeper rejection",()=>{
 for(const s of ["STAGE3Z_BAD_EXPECTED_SHA","STAGE3Z_M3_BINARY_HASH_MISMATCH",
    "STAGE3Z_BINARY_SHA256:","STAGE3Z_GATEKEEPER_ASSESSMENT_ACCEPTED",
    "STAGE3Z_GATEKEEPER_ASSESSMENT_REJECTED",
    "STAGE3Z_APP_LAUNCH_NOT_APPROVED"])
   assert.ok(code.includes(s),s);
 assert.match(code,/spctl --assess --type execute/);
 assert.match(code,/exit 5/);
});
test("Verifier is a read-only check and never changes macOS trust",()=>{
 assert.doesNotMatch(code,/xattr\s+-d|spctl\s+--master-disable|codesign\s+--force|security\s+find-generic-password|(?:curl|wget|scp)\s/);
 assert.doesNotMatch(code,/rm\s+-rf|sudo\s|mv\s+"|ditto\s|cp\s+"/);
});
test("On macOS missing Stage3X app fails closed without creating one",()=>{
 if(platform()!=="darwin")return;
 const result=spawnSync("/bin/bash",[new URL(path).pathname],{encoding:"utf8",timeout:3500});
 assert.equal(result.status,2);
 assert.match(result.stderr,/STAGE3Z_APP_MISSING_OR_SYMLINK/);
 assert.doesNotMatch(result.stdout,/STAGE3Z_SIGNED_APP_VERIFIED/);
});
test("New QA Developer-ID signatures request a trusted timestamp for Apple notarization",()=>{
 const builder=readFileSync(new URL("../scripts/build-mesh-qa-stage3x-macos.sh",import.meta.url),"utf8");
 assert.match(builder,/codesign --force --deep --timestamp --options runtime/);
 assert.doesNotMatch(builder,/--timestamp=none/);
 assert.match(builder,/--entitlements "\$ENTITLEMENTS"/);
 assert.match(builder,/--features stage3x-qa/);
});
test("Apple notarization requires explicit opt-in and Keychain profile, then Gatekeeper acceptance",()=>{
 const s=readFileSync(new URL("../scripts/notarize-mesh-qa-stage3x-macos.sh",import.meta.url),"utf8");
 for(const part of [
  "YES_EXPLICIT_APPLE_SUBMISSION","STAGE3Z_NOTARY_KEYCHAIN_PROFILE_REQUIRED",
  "STAGE3Z_NOTARY_SECURE_TIMESTAMP_REQUIRED","--keychain-profile",
  "notarytool submit","--wait --output-format json","xcrun stapler staple",
  "xcrun stapler validate","spctl --assess --type execute",
  "STAGE3Z_APP_NOTARIZED_AND_GATEKEEPER_ACCEPTED"
 ])assert.ok(s.includes(part),part);
 assert.doesNotMatch(s,/--apple-id|--password|--key-id|--key "\$|security find-generic-password|spctl --master-disable|xattr -d/);
 const approvalPos=s.indexOf("YES_EXPLICIT_APPLE_SUBMISSION");
 const submitPos=s.indexOf("notarytool submit");
 assert.ok(approvalPos>=0&&approvalPos<submitPos);
});
test("Notarization command refuses uploads without explicit authorization",()=>{
 if(platform()!=="darwin")return;
 const script=new URL("../scripts/notarize-mesh-qa-stage3x-macos.sh",import.meta.url).pathname;
 const result=spawnSync("/bin/bash",[script],{
  encoding:"utf8",timeout:3500,
  env:{PATH:process.env.PATH||"/usr/bin:/bin",HOME:process.env.HOME||"/tmp"}
 });
 assert.equal(result.status,2);
 assert.match(result.stderr,/STAGE3Z_APPLE_SUBMISSION_NOT_AUTHORIZED/);
 assert.doesNotMatch(result.stdout,/STAGE3Z_APPLE_NOTARY_SUBMISSION_STARTED/);
});
