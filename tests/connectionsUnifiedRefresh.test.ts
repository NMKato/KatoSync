import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const provider=src("../src/components/ProviderManager.tsx");
const github=src("../src/components/GithubAppConnectionPanel.tsx");
const mesh=src("../src/components/MeshConnectionCard.tsx");
test("one safe connections refresh triggers model status and both independent cards",()=>{
 assert.ok(provider.includes('"connections.refreshAll"'));
 assert.ok(provider.includes('await vm.handleRefreshProviders(true)'));
 assert.ok(provider.includes('setConnectionRefreshEpoch(previous=>previous+1)'));
 assert.ok(provider.includes('refreshEpoch={connectionRefreshEpoch}'));
 assert.ok(!provider.includes('github_app_disconnect'));
 assert.ok(!provider.includes('mesh_account_device_discover'));
});
test("github allows explicit refresh when connected and on global refresh",()=>{
 assert.ok(github.includes('onClick={refreshStatus}'));
 assert.ok(github.includes('"connections.refreshGithub"'));
 assert.ok(github.includes('},[refreshEpoch]);'));
 assert.ok(github.includes('invoke<Status>("github_app_connection_status")'));
 assert.ok(github.includes('setStatus(null)'));
 assert.ok(github.includes('disabled={busy||Boolean(device)}'));
});
test("mesh refresh is read-only and never starts registration or pairing",()=>{
 assert.ok(mesh.includes('aria-label={t("connections.refreshMesh")}'));
 assert.ok(mesh.includes('onClick={()=>void refresh()}'));
 assert.ok(mesh.includes('},[refresh,refreshEpoch]);'));
 const block=mesh.slice(mesh.indexOf("const refresh=useCallback(async()=>"),mesh.indexOf("},[]);",mesh.indexOf("const refresh=useCallback(async()=>"))+6);
 assert.ok(block.includes('"mesh_local_readiness"'));
 for(const denied of ["mesh_account_device_discover","mesh_pairing_offer_create","mesh_local_approve_peer","mesh_local_revoke_peer","renew_katoos_qa_session"])
  assert.ok(!block.includes(denied),denied);
 assert.ok(mesh.includes("setDirectory(null)"));
 assert.ok(mesh.includes('status: "preference_only"'));
});
test("refresh labels available in four languages",()=>{
 for(const lang of ["de","en","es","ru"]){
  const file=src("../src/i18n/locales/"+lang+".ts");
  for(const key of ["refreshAll","refreshGithub","refreshMesh","refreshHint"])
   assert.ok(file.includes('"connections.'+key+'":'),lang+":"+key);
 }
});
