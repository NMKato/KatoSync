// Created by NMKato Solutions — Stage4T human-first Mesh UI source/visual/safety contracts.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const ui=read("src/components/MeshConnectionCard.tsx");
const styles=read("src/styles.css");

test("exactly three understandable stages are visible in simplified mode",()=>{
  assert.match(ui,/className="vision-mesh-simple-steps"/);
  assert.match(ui,/mesh\.easy\.stepFind/);
  assert.match(ui,/mesh\.easy\.stepAccept/);
  assert.match(ui,/mesh\.easy\.stepCompare/);
  assert.match(ui,/easySession\|\|locallyPaired\?"complete":"active"/);
  assert.match(ui,/easyStage==="compare"\?"active":"pending"/);
});
test("one request cannot be sent when an inbound request is awaiting a decision",()=>{
  assert.match(ui,/device\.fingerprint!==agentBootstrap\?\.fingerprint&&!easySession&&\s*!recipientInbox\?\.length&&!acceptedInboxOffer/);
  assert.match(ui,/if\(canRequest\)void sendNativeInbox\(device\.deviceId,true\)/);
  assert.doesNotMatch(ui,/onMouseOver=\{\(\)=>void sendNativeInbox/);
});
test("device cards do not mislabel an in-progress request as a former app",()=>{
  assert.match(ui,/easySession\?\.peerDeviceId===device\.deviceId\?"mesh\.easy\.requestInProgress"/);
  assert.match(ui,/recent\?"mesh\.easy\.notAvailable":"mesh\.easy\.history"/);
  assert.match(ui,/data-selected=\{selectedDeviceId===device\.deviceId\}/);
  assert.doesNotMatch(ui,/aria-pressed=\{selectedDeviceId===device\.deviceId\}/);
});
test("incoming messages use verified friendly account roster identity",()=>{
  assert.match(ui,/d\.deviceId===item\.sourceDeviceId&&\s*d\.fingerprint===item\.fingerprint/);
  assert.match(ui,/source\?displayRegistrationName\(source\)/);
  assert.match(ui,/className="vision-mesh-invite-actions"/);
  assert.match(ui,/vision-mesh-accept/);
  assert.match(ui,/vision-mesh-decline/);
  assert.match(ui,/onClick=\{\(\)=>void decideRecipientInvite\(item,"accept"\)\}/);
  assert.match(ui,/onClick=\{\(\)=>void decideRecipientInvite\(item,"reject"\)\}/);
});
test("accepted invite displays its own next-action status, not empty inbox",()=>{
  assert.match(ui,/recipientInbox\?\.length===0&&!acceptedInboxOffer&&recipientDecision!=="accepted"/);
  assert.match(ui,/className="vision-mesh-received-confirmation"/);
  assert.match(ui,/mesh\.easy\.acceptedHint/);
});
test("compact layout is responsive, separated, keyboard focused and respects reduced motion",()=>{
  for(const selector of [
    ".vision-mesh-simple-steps",".vision-mesh-easy-panel",
    ".vision-mesh-account-directory",".vision-mesh-recipient-inbox",
    ".vision-mesh-invite-card",".vision-mesh-invite-actions",
    ".vision-mesh-inbox-empty"
  ])assert.ok(styles.includes(selector),"missing style "+selector);
  assert.match(styles,/@media\(max-width:760px\)/);
  assert.match(styles,/@media\(max-width:420px\)/);
  assert.match(styles,/:focus-visible/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
});
test("all localizations cover the three stages and accept/reject actions",()=>{
  for(const locale of ["de","en","ru","es"]){
    const source=read("src/i18n/locales/"+locale+".ts");
    for(const key of [
      "mesh.easy.stepsLabel","mesh.easy.stepFind","mesh.easy.stepAccept",
      "mesh.easy.stepCompare","mesh.easy.requestInProgress","mesh.easy.notAvailable",
      "mesh.easy.incomingFrom","mesh.easy.acceptedHint","mesh.recipient.accept",
      "mesh.recipient.reject"
    ])assert.ok(source.includes('"'+key+'":'),locale+": "+key);
  }
});
test("human approval and transport gate remain unchanged",()=>{
  assert.match(ui,/onClick=\{\(\)=>void approveEasyPeer\(\)\}/);
  assert.match(ui,/canQuickApproveSameCode\(/);
  assert.match(ui,/mesh_local_approve_peer/);
  assert.match(ui,/mesh\.easy\.noTransport/);
  assert.doesNotMatch(ui,/remote_task_execute\(/);
});
