// NMKato Solutions: preference is local intent, not an elected hub.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const native=read("../src-tauri/src/mesh_hub.rs");
const lib=read("../src-tauri/src/lib.rs");
const ui=read("../src/components/MeshConnectionCard.tsx");
test("Hub preference is locally persisted with verified readback",()=>{
 assert.ok(lib.includes("mesh_hub::mesh_hub_preference_get"));
 assert.ok(lib.includes("mesh_hub::mesh_hub_preference_set"));
 assert.ok(native.includes("app_config_dir()"));
 assert.ok(native.includes("sync_all()"));
 assert.ok(native.includes("fs::rename(&temp, path)"));
 assert.ok(native.includes("let reloaded = load(&path)?"));
 assert.ok(native.includes("serde(deny_unknown_fields)"));
});
test("A preference is never a connection, transport or remote job privilege",()=>{
 assert.ok(native.includes("hub_active: false"));
 assert.ok(native.includes("transport_ready: false"));
 assert.ok(native.includes("remote_jobs_enabled: false"));
 assert.ok(native.includes('status: "preference_only"'));
 for (const invalid of ["TcpListener","reqwest::","peer_approve","remote_execute","WebSocket"])
  assert.ok(!native.includes(invalid));
});
test("Controls are under Details, never on Vision and never show active hub",()=>{
 assert.ok(ui.includes('"mesh_hub_preference_get"'));
 assert.ok(ui.includes('"mesh_hub_preference_set"'));
 assert.ok(ui.includes('disabled={!hubPreference||hubBusy}'));
 assert.ok(ui.includes('hidden={!detailsOpen}'));
 assert.ok(ui.includes('t("mesh.hub.notActive")'));
 assert.ok(ui.indexOf('className="mesh-hub-preference"') > ui.indexOf('id="vision-mesh-technical-details"'));
 assert.ok(!read("../src/components/VisionWorkspace.tsx").includes("mesh_hub_preference_set"));
});
test("Hub preferences have four locale translations",()=>{
 for(const code of ["de","en","es","ru"]){
  const t=read("../src/i18n/locales/"+code+".ts");
  for(const key of ["heading","prefer","description","notActive","error"])
   assert.ok(t.includes('"mesh.hub.'+key+'":'),code+":"+key);
 }
});
