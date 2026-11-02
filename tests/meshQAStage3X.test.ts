import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const r=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const cfg=JSON.parse(r("src-tauri/tauri.mesh-qa-stage3x.conf.json"));
const build=r("scripts/build-mesh-qa-stage3x-macos.sh");
const doc=r("docs/KATOSYNC_MESH_STAGE3X_KATOOS_LIVE_SCHEMA_2026-11-02.md");
test("Stage3X has a distinct native bundle identifier and visible QA title",()=>{
 assert.equal(cfg.identifier,"com.nmkato.katosync.meshqa.stage3x");
 assert.notEqual(cfg.identifier,"com.nmkato.katosync.meshqa");
 assert.match(cfg.app.windows[0].title,/Stage3X/);
});
test("Stage3X signed QA installer never overwrites earlier apps",()=>{
 assert.match(build,/! -e "\$OUT"/);
 assert.match(build,/STAGE3X_UNEXPECTED_OUTPUT_PATH/);
 assert.match(build,/KatoSync Mesh QA Stage2I\.app/);
 assert.match(build,/KatoSync Mesh QA Stage3X\.app/);
 assert.match(build,/codesign --verify --deep --strict "\$BASE"/);
 assert.match(build,/codesign --verify --deep --strict "\$OUT"/);
 assert.match(build,/PlistBuddy.*CFBundleIdentifier/);
 assert.match(build,/--features katoos-auth-qa/);
 assert.match(build,/VITE_KATOOS_AUTH_QA=1 npm run build/);
});
test("Stage3X production schema history explicitly records server-generated migration versions",()=>{
 const versions=["20261102143138","20261102143254","20261102143424","20261102143501","20261102143529"];
 for(const version of versions)assert.ok(doc.includes(version),version);
 assert.match(doc,/kein.*Remote-Jobs/);
 assert.match(doc,/PITR/);
});
