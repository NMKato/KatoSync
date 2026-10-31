// NMKato Solutions – Stage 3E: primary Mesh card safety and truthful UI.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const view=read("../src/components/MeshConnectionCard.tsx");
const css=read("../src/styles.css");
const native=read("../src-tauri/src/mesh_directory.rs");

test("Connect opens a read-only verified account roster, Find explicitly enrolls",()=>{
 const guide=view.slice(view.indexOf("const loadAccountDirectory=async("),view.indexOf("const [clipboardStatus"));
 assert.match(guide,/mode:"list"\|"discover"="discover"/);
 assert.match(guide,/mode==="list"\?"mesh_account_devices_list":"mesh_account_device_discover"/);
 assert.match(guide,/if\(!directory&&!directoryBusy\)void loadAccountDirectory\("list"\)/);
 assert.match(guide,/void loadAccountDirectory\("discover"\)/);
 const actions=view.slice(view.indexOf('<div className="vision-mesh-compact-actions">'),
   view.indexOf("</div>",view.indexOf('<div className="vision-mesh-compact-actions">')));
 assert.match(actions,/onClick=\{startConnectionGuide\}/);
 assert.match(actions,/onClick=\{discoverDevices\}/);
 assert.doesNotMatch(actions,/prepareAndInvite|sendNativeInbox|mesh_local_approve_peer/);
 assert.match(native,/discovery_only: true/);
 assert.match(native,/transport_ready: false/);
});
test("guide is above hidden diagnostics; device selection never auto sends, grants trust or starts mTLS",()=>{
 const visible=view.indexOf('{guideOpen?<div className="vision-mesh-guide"');
 const hidden=view.indexOf('<div className="vision-mesh-technical"');
 assert.ok(visible>0&&hidden>visible);
 const guide=view.slice(visible,hidden);
 assert.match(guide,/aria-pressed=\{selectedDeviceId===device\.deviceId\}/);
 assert.match(guide,/onClick=\{\(\)=>setSelectedDeviceId\(device\.deviceId\)\}/);
 assert.match(guide,/selectedDevice\.membershipState==="discovered"&&qaAuthEnabled/);
 assert.match(guide,/inboxSendEnabled\?/);
 assert.match(guide,/onClick=\{\(\)=>void sendNativeInbox\(selectedDevice\.deviceId\)\}/);
 assert.match(guide,/onClick=\{\(\)=>void prepareNativeInbox\(selectedDevice\.deviceId\)\}/);
 assert.match(guide,/mesh\.guide\.sendUnavailable/);
 assert.match(guide,/mesh\.inbox\.noTrust/);
 assert.doesNotMatch(guide,/setConnected|remote_task_execute|mesh_local_approve_peer/);
 assert.match(view,/setSelectedDeviceId\(null\)/);
 assert.match(view,/setDirectory\(null\)/);
});
test("inbox is visible only after explicit QA gate, and accept/reject is not pairing",()=>{
 const visible=view.slice(view.indexOf('{guideOpen?<div className="vision-mesh-guide"'),
  view.indexOf('<div className="vision-mesh-technical"'));
 assert.match(visible,/inboxReceiveEnabled\?<section/);
 assert.match(visible,/onClick=\{\(\)=>void loadRecipientInbox\(\)\}/);
 assert.match(visible,/decideRecipientInvite\(item,"accept"\)/);
 assert.match(visible,/decideRecipientInvite\(item,"reject"\)/);
 assert.match(visible,/mesh\.recipient\.notConnected/);
 assert.match(view,/result\.paired!==false/);
 assert.match(view,/result\.remoteJobsEnabled!==false/);
});
test("manual signed copy/paste, SAS approval and revoke remain in technical details",()=>{
 const hidden=view.slice(view.indexOf('<div className="vision-mesh-technical"'));
 assert.match(hidden,/onClick=\{\(\)=>void prepareAndInvite\(\)\}/);
 assert.match(hidden,/onClick=\{\(\)=>void verifyResponse\(\)\}/);
 assert.match(hidden,/onClick=\{\(\)=>void approvePeer\(\)\}/);
 assert.match(hidden,/onClick=\{\(\)=>void revokePeer\(peer\.fingerprint\)\}/);
 assert.match(view,/mesh_pairing_response_verify/);
 assert.match(view,/mesh_local_approve_peer/);
 assert.match(view,/mesh_local_revoke_peer/);
 assert.match(view,/id="vision-mesh-technical-details" hidden=\{!detailsOpen\}/);
 assert.match(view,/role="region"/);
});
test("guide has responsive accessible surface tokens and four translated locale variants",()=>{
 assert.match(css,/\.provider-mesh-card \.vision-mesh-guide-device\[aria-pressed="true"\]/);
 assert.match(css,/\.provider-mesh-card \.vision-mesh-guide-device:focus-visible/);
 assert.match(css,/background:var\(--surface-raised\)/);
 assert.match(css,/@media\(max-width:420px\)/);
 for(const lang of ["de","en","es","ru"]){
  const data=read("../src/i18n/locales/"+lang+".ts");
  for(const key of ["heading","notConnected","description","notLoaded","loading",
    "choose","selected","target","sendUnavailable"])
   assert.ok(data.includes('"mesh.guide.'+key+'":'),lang+"/"+key);
 }
});
