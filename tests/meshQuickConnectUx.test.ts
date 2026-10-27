// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const ui=read("../src/components/VisionWorkspace.tsx");
const native=read("../src-tauri/src/mesh_identity.rs");

test("quick connect prepares verified identity first, then signs a bounded invitation",()=>{
  const block=ui.slice(ui.indexOf("const prepareAndInvite=async"),ui.indexOf("const checkAndPrepareReply=async"));
  assert.ok(block.indexOf("mesh_device_identity_prepare")>=0);
  assert.ok(block.indexOf("mesh_pairing_offer_create")>block.indexOf("mesh_device_identity_prepare"));
  assert.match(block,/actual\.paired\|\|actual\.peerCount\|\|actual\.transportReady/);
  assert.match(block,/const failure=classifyMeshIdentityFailure\(error\)/);
  assert.match(block,/setIdentityFailure\(failure\)/);
  assert.match(block,/setReauthResult\(null\)/);
  assert.match(block,/setIdentity\(null\)/);
  assert.match(native,/OFFER_LIFETIME_SECS: i64 = 300/);
});
test("receiving an invitation prepares a cryptographic challenge, never trust",()=>{
  const block=ui.slice(ui.indexOf("const checkAndPrepareReply=async"),ui.indexOf("const checkInventory="));
  assert.ok(block.indexOf("mesh_pairing_offer_inspect")>=0);
  assert.ok(block.indexOf("mesh_pairing_challenge_create")>block.indexOf("mesh_pairing_offer_inspect"));
  assert.doesNotMatch(block, /mesh_local_approve_peer|mesh_local_readiness|mesh_local_approved_peers/);
  assert.match(ui,/mesh\.quick\.notPaired/);
  assert.match(ui,/mesh\.quick\.discoveryPending/);
});
test("clipboard transfers only public signed payloads; no implicit enrollment",()=>{
  const block=ui.slice(ui.indexOf("const copyPublicMessage=async"),ui.indexOf("const prepareAndInvite=async"));
  assert.match(block,/navigator\.clipboard\.writeText\(payload\)/);
  assert.doesNotMatch(block,/set_password|save_supabase|remote_task_execute/);
  assert.doesNotMatch(ui,/mesh_pairing_accept|autoApprovePeer|remote_task_execute/);
});
test("quick connect translated and advanced SAS flow retained",()=>{
  for(const lang of ["de","en","es","ru"]){
    const translations=read("../src/i18n/locales/"+lang+".ts");
    for(const key of ["heading","connect","receivedInvite","notPaired","discoveryPending","technicalOptions"])
      assert.ok(translations.includes('"mesh.quick.'+key+'":'),lang+" missing "+key);
  }
  assert.match(ui,/vision-mesh-advanced/);
  assert.match(ui,/mesh_local_approve_peer/);
  assert.match(ui,/mesh\.v3\.confirmCode/);
  assert.match(ui,/mesh\.v0\.noDispatch/);
});
