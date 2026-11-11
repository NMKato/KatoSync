// Created by NMKato Solutions — truthful Mesh pairing and device labels
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const view=src("src/components/MeshConnectionCard.tsx");
const build=src("scripts/build-mesh-qa-stage4j-candidate-macos.sh");

test("pairing guide visibly discloses lack of QA send and receive",()=>{
  const ui=view.slice(view.indexOf('{guideOpen?<div className="vision-mesh-guide"'),
     view.indexOf('<div className="vision-mesh-technical"'));
  assert.match(ui,/!inboxSendEnabled\?<p className="vision-mesh-compact-notice" role="status">/);
  assert.match(ui,/mesh\.guide\.deliveryDisabled/);
  assert.match(ui,/!inboxReceiveEnabled\?<p className="vision-mesh-compact-notice" role="status">/);
  assert.match(ui,/mesh\.recipient\.disabled/);
  assert.match(ui,/mesh\.guide\.advancedPreparation/);
  assert.match(ui,/mesh\.guide\.preparationDoesNotSend/);
  assert.match(ui,/onClick=\{\(\)=>void prepareNativeInbox\(selectedDevice\.deviceId\)\}/);
  assert.match(ui,/inboxSendEnabled\?/);
  assert.match(ui,/onClick=\{\(\)=>void sendNativeInbox\(selectedDevice\.deviceId\)\}/);
  assert.doesNotMatch(ui,/remote_task_execute\(|setConnected\(/);
});

test("current default signing build does not advertise real send or accept",()=>{
  assert.match(build,/VITE_KATOOS_AUTH_QA=1/);
  assert.doesNotMatch(build,/VITE_MESH_INBOX_SEND_QA=1/);
  assert.doesNotMatch(build,/VITE_MESH_INBOX_RECEIVE_QA=1/);
  assert.match(view,/const inboxSendEnabled=qaAuthEnabled&&import\.meta\.env\.VITE_MESH_INBOX_SEND_QA==="1"/);
  assert.match(view,/const inboxReceiveEnabled=qaAuthEnabled&&import\.meta\.env\.VITE_MESH_INBOX_RECEIVE_QA==="1"/);
});

test("device display does not invent an unverified MacBook model",()=>{
  assert.match(view,/registeredPlatform\(device\.platformOs\)/);
  assert.match(view,/mesh\.directory\.modelUnverified/);
  assert.match(view,/mesh\.directory\.identitySuffix/);
  assert.match(view,/agentBootstrap\?\.hardware\.chipFamily\|\|t\("mesh\.directory\.modelUnverified"\)/);
  assert.match(view,/presentation\.olderEntries\.map\(renderRegistration\)/);
  assert.doesNotMatch(view,/device\.platformOs==="macos"\?"MacBook/);
});

test("German, English, Russian and Spanish have the same safety messages",()=>{
  const keys=["mesh.directory.deviceMac","mesh.directory.deviceWindows",
      "mesh.directory.deviceLinux","mesh.directory.modelUnverified",
      "mesh.directory.identitySuffix","mesh.guide.deliveryDisabled",
      "mesh.recipient.disabled","mesh.guide.advancedPreparation",
      "mesh.guide.preparationDoesNotSend"];
  for(const lang of ["de","en","ru","es"]) {
    const text=src("src/i18n/locales/"+lang+".ts");
    for(const key of keys) assert.ok(text.includes('"'+key+'":'),lang+"/"+key);
  }
});

test("native QA inbox and relay paths target only QA-suffixed Edge functions",()=>{
  const native=[
    ["src-tauri/src/mesh_inbox.rs","mesh-inbox-send-qa","KATOSYNC_MESH_INBOX_SEND_QA"],
    ["src-tauri/src/mesh_inbox_receiver.rs","mesh-inbox-receive-qa","KATOSYNC_MESH_INBOX_RECEIVE_QA"],
    ["src-tauri/src/mesh_relay_client.rs","mesh-pairing-relay-qa","KATOSYNC_MESH_PAIRING_RELAY_QA"]
  ] as const;
  for(const [file,endpoint,flag] of native) {
    const text=src(file);
    assert.ok(text.includes('functions/v1/'+endpoint),file+" lacks QA route");
    assert.ok(text.includes(flag),file+" lacks native opt-in guard");
    assert.doesNotMatch(text,/functions\/v1\/mesh-inbox-(?:send|receive)"/);
    assert.doesNotMatch(text,/functions\/v1\/mesh-pairing-relay"/);
  }
  assert.match(src("src-tauri/src/mesh_inbox.rs"),/!cfg!\(feature = "katoos-auth-qa"\) \|\| !send_qa_enabled\(\)/);
  assert.match(src("src-tauri/src/mesh_inbox_receiver.rs"),/!cfg!\(feature = "katoos-auth-qa"\) \|\| !receiver_qa_enabled\(\)/);
  assert.match(src("src-tauri/src/mesh_relay_client.rs"),/if !qa_enabled\(\)/);
});
