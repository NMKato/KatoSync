import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("Stage35 has an isolated app identifier and standalone Keychain",()=>{
 const cfg=JSON.parse(read("src-tauri/tauri.mesh-qa-stage35.conf.json"));
 const cargo=read("src-tauri/Cargo.toml");
 const native=read("src-tauri/src/lib.rs");
 const auth=read("src-tauri/src/github_app_auth.rs");
 assert.equal(cfg.identifier,"com.nmkato.katosync.meshqa.stage35");
 assert.match(cargo,/stage35-qa = \["stage3x-qa"\]/);
 assert.ok(native.includes("com.nmkato.katosync.katoos.stage35.qa"));
 assert.ok(auth.includes("com.nmkato.katosync.katoos.stage35.qa"));
 assert.ok(native.includes("KatoSync Mesh QA Stage35"));
 assert.ok(native.includes("com.nmkato.katosync.meshqa.stage35.sync"));
});
test("Stage35 build never overwrites Stage3X, stable or Stage2I",()=>{
 const script=read("scripts/build-mesh-qa-stage35-macos.sh");
 assert.ok(script.includes('BASE="$HOME/Applications/KatoSync Mesh QA Stage3X.app"'));
 assert.ok(script.includes('OUT="$HOME/Applications/KatoSync Mesh QA Stage35.app"'));
 assert.ok(script.includes('! -e "$OUT"'));
 assert.ok(script.includes("codesign --verify --deep --strict"));
 assert.ok(script.includes('--features stage35-qa'));
 assert.ok(script.includes("STAGE35_SIGNED_SEPARATE_QA_APP_READY"));
 assert.doesNotMatch(script,/supabase (?:db push|functions deploy)/);
});
test("Apple upload uses an explicit approval gate and signed nested helper",()=>{
 const script=read("scripts/notarize-mesh-qa-stage35-macos.sh");
 assert.ok(script.includes("KATOSYNC_STAGE35_APPLE_UPLOAD_APPROVED"));
 assert.ok(script.includes("YES_EXPLICIT_APPLE_SUBMISSION"));
 assert.ok(script.includes("katosync-stage35-notary"));
 assert.ok(script.includes("codesign --verify --strict"));
 assert.ok(script.includes("spctl --assess"));
});
