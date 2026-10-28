import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const qa=JSON.parse(readFileSync(new URL("../src-tauri/tauri.mesh-qa.conf.json",import.meta.url),"utf8"));
const prod=JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8"));
const cmd=readFileSync(new URL("../scripts/build-mesh-qa-macos.sh",import.meta.url),"utf8");
test("Mesh QA app has a different bundle id and visible QA window title",()=>{
 assert.equal(qa.identifier,"com.nmkato.katosync.meshqa");
 assert.notEqual(qa.identifier,prod.identifier);
 assert.equal(qa.app.windows[0].title,"KatoSync · Mesh QA (isoliert)");
 assert.equal(qa.build.beforeBuildCommand,"");
});
test("isolated QA bundle always builds auth feature, verifies Team signature and never edits stable",()=>{
 assert.match(cmd,/VITE_KATOOS_AUTH_QA=1 npm run build/);
 assert.match(cmd,/--features katoos-auth-qa/);
 assert.match(cmd,/--config src-tauri\/tauri\.mesh-qa\.conf\.json/);
 assert.match(cmd,/codesign --verify --deep --strict/);
 assert.match(cmd,/KATOSYNC_QA_SIGNING_IDENTITY/);
 assert.match(cmd,/MESH_QA_BASE_SIGN_OR_OUTPUT_PRECONDITION_FAILED/);
 assert.doesNotMatch(cmd,/\/Applications\/KatoSync\.app/);
});
