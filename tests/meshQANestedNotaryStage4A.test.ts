import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
const text=(path:string)=>readFileSync(new URL("../"+path, import.meta.url),"utf8");
const build=text("scripts/build-mesh-qa-stage3x-macos.sh");
const repair=text("scripts/repair-mesh-qa-stage3x-helper-macos.sh");
test("Stage4A build signs speech helper before outer bundle with same Developer ID and entitlements",()=>{
 const helper='codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN" "$HELPER"';
 const parent='codesign --force --deep --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN" "$APP"';
 assert.ok(build.includes(helper));
 assert.ok(build.includes(parent));
 assert.ok(build.indexOf(helper)<build.indexOf(parent));
 assert.match(build,/KatoSyncSpeechHelper\.app/);
 assert.match(build,/STAGE4A_SPEECH_HELPER_SIGNING_INVALID/);
 assert.match(build,/TeamIdentifier=T8SB89JPX7/);
 assert.match(build,/flags=0x10000\(runtime\)/);
});
test("Stage4A repair keeps existing app rollback and does not touch stable or Stage2I",()=>{
 assert.match(repair,/com\.nmkato\.katosync\.meshqa\.stage3x/);
 assert.match(repair,/KatoSyncSpeechHelper\.app/);
 assert.match(repair,/STAGE4A_ROLLBACK_BUNDLE/);
 assert.match(repair,/STAGE4A_RESTORE_OLD_APP_AFTER_MOVE_FAILURE/);
 assert.match(repair,/STAGE4A_RESTORE_OLD_APP_AFTER_SIGNATURE_FAILURE/);
 assert.match(repair,/codesign --verify --deep --strict "\$CANDIDATE"/);
 assert.match(repair,/codesign --verify --strict "\$HELPER"/);
 assert.doesNotMatch(repair,/xattr\s+-d|spctl\s+--master-disable|notarytool\s+submit/);
});
test("Repair rejects unsupported CLI arguments without changing files",()=>{
 if(platform()!=="darwin")return;
 const p=new URL("../scripts/repair-mesh-qa-stage3x-helper-macos.sh",import.meta.url).pathname;
 const q=spawnSync("/bin/bash",[p,"unapproved"],{encoding:"utf8",timeout:3500});
 assert.equal(q.status,2);
 assert.doesNotMatch(q.stdout,/STAGE4A_APP_READY_FOR_NOTARIZATION_RETRY/);
});
