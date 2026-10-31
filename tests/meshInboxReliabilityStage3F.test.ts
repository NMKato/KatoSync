// NMKato Solutions – Stage 3F: Inbox request lifecycle is non-authoritative UI.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {activeMeshInvitations,nextMeshInboxExpiryDelay} from "../src/lib/meshInboxExpiry.ts";
const ui=readFileSync(new URL("../src/components/MeshConnectionCard.tsx",import.meta.url),"utf8");
const entry=(deltaMs:number,now=1_700_000_000_000)=>({
 requestId:"test-"+deltaMs,expiresAt:new Date(now+deltaMs).toISOString()
});
test("expiry filter is deterministic and excludes expired/invalid invitations",()=>{
 const now=1_700_000_000_000;
 const items=[entry(-1,now),entry(0,now),entry(50,now),entry(200,now),
  {requestId:"invalid",expiresAt:"not-a-timestamp"}];
 assert.deepEqual(activeMeshInvitations(items,now).map(x=>x.requestId),["test-50","test-200"]);
 assert.deepEqual(activeMeshInvitations(items,now+201),[]);
 assert.deepEqual(items.map(x=>x.requestId),["test--1","test-0","test-50","test-200","invalid"]);
});
test("single expiration timer is bounded and does not auto-read inbox",()=>{
 const now=1_700_000_000_000;
 assert.equal(nextMeshInboxExpiryDelay([entry(50,now),entry(400,now)],now),60);
 assert.equal(nextMeshInboxExpiryDelay([entry(-50,now)],now),null);
 assert.equal(nextMeshInboxExpiryDelay([{expiresAt:"n/a"}],now),null);
 assert.ok((nextMeshInboxExpiryDelay([entry(100_000_000_000,now)],now)??0)<=2_147_483_000);
 assert.match(ui,/window\.clearTimeout\(timer\)/);
 assert.match(ui,/activeMeshInvitations\(items\)/);
 assert.doesNotMatch(ui,/setInterval\(/);
});
test("synchronous operation tokens prevent UI double-click send or duplicate recipient decision",()=>{
 assert.match(ui,/const inboxInFlight=useRef\(false\)/);
 assert.match(ui,/const recipientInFlight=useRef\(false\)/);
 assert.match(ui,/const rosterInFlight=useRef\(false\)/);
 assert.match(ui,/if\(rosterInFlight\.current\)return/);
 assert.match(ui,/inboxInFlight\.current=true/);
 assert.match(ui,/recipientInFlight\.current=true/);
 assert.match(ui,/operation===inboxOperation\.current/);
 assert.match(ui,/operation===recipientOperation\.current/);
 assert.match(ui,/operation===rosterOperation\.current/);
 assert.match(ui,/nativeInboxSent===targetDeviceId/);
 assert.match(ui,/selectedDeviceId!==targetDeviceId/);
 assert.match(ui,/nativeInboxSent===selectedDevice\.deviceId/);
});
test("account/session refresh drops stale recipients, old device choice and pending results",()=>{
 assert.match(ui,/rosterOperation\.current\+\+;rosterInFlight\.current=false/);
 assert.match(ui,/inboxOperation\.current\+\+;inboxInFlight\.current=false/);
 assert.match(ui,/recipientOperation\.current\+\+;recipientInFlight\.current=false/);
 assert.match(ui,/setNativeInboxPrepared\(null\);setNativeInboxSent\(null\)/);
 assert.match(ui,/setRecipientInbox\(null\);setRecipientDecision\(null\)/);
 assert.match(ui,/setDirectory\(null\);setSelectedDeviceId\(null\);setGuideOpen\(false\)/);
 assert.match(ui,/result\.paired!==false/);
 assert.match(ui,/result\.transportReady!==false/);
 assert.match(ui,/result\.remoteJobsEnabled!==false/);
});
