import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("signed Stage35d candidate is built beside the running notarized app",()=>{
 const script=read("scripts/build-mesh-qa-stage35d-candidate-macos.sh");
 assert.match(script,/OLD="\$HOME\/Applications\/KatoSync Mesh QA Stage35.app"/);
 assert.match(script,/OUTDIR="\$HOME\/Applications\/\.KatoSync-Mesh-Stage35d-Candidate"/);
 assert.match(script,/! -e "\$OUT"/);
 assert.match(script,/codesign --verify --deep --strict "\$OLD"/);
 assert.match(script,/xcrun stapler validate "\$OLD"/);
 assert.match(script,/CARGO_TARGET_DIR/);
 assert.doesNotMatch(script,/mv "\$OLD"/);
 assert.doesNotMatch(script,/rm -rf .*"\$OLD"/);
});
test("Stage35d keeps same bundle ID and keys while enabling opt-in heartbeat",()=>{
 const script=read("scripts/build-mesh-qa-stage35d-candidate-macos.sh");
 assert.match(script,/ID="com.nmkato.katosync.meshqa.stage35"/);
 assert.match(script,/VITE_STAGE35_HEARTBEAT_QA=1/);
 assert.match(script,/VITE_STAGE35_AUTO_RESUME_QA=1/);
 assert.match(script,/--features stage35-qa/);
 assert.match(script,/codesign --force --timestamp --options runtime/);
});
test("Apple submission is strictly targeted to candidate and never unguarded",()=>{
 const script=read("scripts/notarize-mesh-qa-stage35d-candidate-macos.sh");
 assert.match(script,/KATOSYNC_STAGE35_APPLE_UPLOAD_APPROVED/);
 assert.match(script,/YES_EXPLICIT_APPLE_SUBMISSION/);
 assert.match(script,/--keychain-profile/);
 assert.match(script,/spctl --assess --type execute/);
 assert.match(script,/\.KatoSync-Mesh-Stage35d-Candidate/);
 assert.doesNotMatch(script,/supabase db|cloudflare|stripe/i);
});

test("controlled install keeps notarized fallback and never changes Stage3X",()=>{
 const script=read("scripts/install-mesh-qa-stage35d-candidate-macos.sh");
 assert.ok(script.includes('.KatoSync-Mesh-Stage35-Pre35d-20261104.app'));
 assert.ok(script.includes('! -e "$BACKUP"'));
 assert.ok(script.includes('mv "$APP" "$BACKUP"'));
 assert.ok(script.includes('mv "$BACKUP" "$APP"'));
 assert.ok(script.includes('spctl --assess --type execute'));
 assert.ok(script.includes('open -na "$APP"'));
 assert.doesNotMatch(script,/\b(?:delete-generic-password|security delete|rm -rf .*Keychain|supabase db push)\b/);
});
