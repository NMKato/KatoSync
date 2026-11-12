// Created by NMKato Solutions — Stage4S owner-driven simplified pairing QA.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const ui=read("src/components/MeshConnectionCard.tsx");
const begin=ui.indexOf("const sendNativeInbox=async");
const auto=ui.indexOf("// Stage4S: background only AFTER");
const approval=ui.indexOf("const approveEasyPeer=async");
const turn=ui.indexOf("return <section className=");
test("one-click device selection explicitly sends only for discovered fresh non-self peers",()=>{
 assert.match(ui,/const canRequest=easyEnabled&&approvedPeers!==null&&!alreadyPinned&&recent&&\s*device\.membershipState==="discovered"/);
 assert.match(ui,/const alreadyPinned=approvedPeers\?\.some\(pin=>/);
 assert.match(ui,/pin\.status==="locally_approved"&&pin\.fingerprint===device\.fingerprint/);
 assert.match(ui,/device\.fingerprint!==agentBootstrap\?\.fingerprint&&!easySession/);
 assert.match(ui,/if\(canRequest&&!alreadyPinned\)void sendNativeInbox\(device\.deviceId,true\)/);
 assert.match(ui,/if\(canSelectPinned\)\{setLanQaConsent\(false\);setLanQaResult\(null\);\}/);
 assert.match(ui,/!directory\?\.devices\.some\(d=>d\.deviceId===targetDeviceId&&d\.membershipState==="discovered"\)/);
 assert.ok(begin>0);
});
test("background protocol is bounded to the signed request and cancels on expiration",()=>{
 assert.ok(auto>0&&auto<turn);
 assert.match(ui,/matchEasyRelayMessage\(easySession,message,now\)/);
 assert.match(ui,/setInterval\(refresh,EASY_RELAY_POLL_MS\)/);
 assert.match(ui,/window\.setInterval\(\(\)=>void loadRecipientInbox\(true\),8_000\)/);
 assert.match(ui,/setTimeout\(\(\)=>\{\s*setEasySession\(null\);setEasyStage\("expired"\)/);
 assert.match(ui,/if\(!easyEnabled\|\|!easySession\|\|!challengeRelayWork/);
 assert.match(ui,/if\(!easyEnabled\|\|!easySession\|\|!responseRelayWork/);
 const effectsEnd=ui.indexOf("const selectedDevice=directory",auto);
 assert.ok(effectsEnd>auto);
 assert.doesNotMatch(ui.slice(auto,effectsEnd),/mesh_local_approve_peer/);
});
test("account login, relay or SAS proof alone cannot grant trust",()=>{
 assert.ok(approval>0);
 const action=ui.slice(approval,ui.indexOf("const revokePeer=",approval));
 assert.match(action,/canQuickApproveSameCode/);
 assert.match(action,/explicitOwnerConfirmation:true/);
 assert.match(action,/mesh_local_approve_peer/);
 assert.match(ui,/onClick=\{\(\)=>void approveEasyPeer\(\)\}/);
 assert.match(ui,/mesh\.easy\.approvedLocalOnly/);
 assert.match(ui,/mesh\.easy\.noTransport/);
 assert.doesNotMatch(ui,/setConnected\(|remote_task_execute\(/);
});
test("four languages and existing hidden QA controls remain available",()=>{
 for(const locale of ["de","en","ru","es"]) {
  const content=read("src/i18n/locales/"+locale+".ts");
  for(const key of ["mesh.easy.title","mesh.easy.connect","mesh.easy.waiting",
   "mesh.easy.compareOnlyOnDevices","mesh.easy.codesMatch",
   "mesh.easy.approvedLocalOnly","mesh.easy.noTransport","mesh.easy.advanced"]) {
    assert.ok(content.includes('"'+key+'":'),locale+"/"+key);
  }
 }
 assert.match(ui,/manualMeshControls=!easyEnabled/);
 assert.match(ui,/const easyEnabled=import\.meta\.env\.VITE_MESH_EASY_PAIR_QA==="1"/);
 assert.match(ui,/role="status"/);
});
