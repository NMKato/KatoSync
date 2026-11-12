import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {canSelectLocallyApprovedPeerForQa} from "../src/lib/meshPairedSelection4X.ts";

const own="23-15-56-A8-63-4F-3A-46-06-94-03-1A-04-70-78-01";
const other="12-CA-19-C8-3C-A5-AB-76-01-84-84-CF-00-5D-6E-4D";
const peer={fingerprint:other,membershipState:"discovered"};
const pins=[{fingerprint:other,status:"locally_approved"}];
const options={enabled:true,peer,approvedPeers:pins,ownFingerprint:own};

test("a previously locally paired peer is selectable for read-only QA without a new invitation",()=>{
 assert.equal(canSelectLocallyApprovedPeerForQa(options),true);
 assert.equal(canSelectLocallyApprovedPeerForQa({...options,peer:{...peer,membershipState:"trusted"}}),true);
});
test("a pinned peer is not selectable without the explicitly compiled QA interface",()=>{
 assert.equal(canSelectLocallyApprovedPeerForQa({...options,enabled:false}),false);
});
test("never select self, revoked, malformed, missing or unapproved local peers",()=>{
 assert.equal(canSelectLocallyApprovedPeerForQa({...options,peer:{...peer,fingerprint:own}}),false);
 assert.equal(canSelectLocallyApprovedPeerForQa({...options,ownFingerprint:null}),false);
 assert.equal(canSelectLocallyApprovedPeerForQa({...options,peer:{...peer,membershipState:"revoked"}}),false);
 assert.equal(canSelectLocallyApprovedPeerForQa({...options,peer:{...peer,fingerprint:"invalid"}}),false);
 assert.equal(canSelectLocallyApprovedPeerForQa({...options,approvedPeers:null}),false);
 assert.equal(canSelectLocallyApprovedPeerForQa({...options,approvedPeers:[]}),false);
 assert.equal(canSelectLocallyApprovedPeerForQa({...options,approvedPeers:[{fingerprint:other,status:"pending"}]}),false);
 assert.equal(canSelectLocallyApprovedPeerForQa({...options,approvedPeers:[{fingerprint:other,status:"revoked"}]}),false);
 assert.equal(canSelectLocallyApprovedPeerForQa({...options,peer:null}),false);
});
test("existing locally paired selection never calls the invite-sending routine",()=>{
 const source=readFileSync(new URL("../src/components/MeshConnectionCard.tsx",import.meta.url),"utf8");
 assert.match(source,/const canSelectPinned=canSelectLocallyApprovedPeerForQa/);
 assert.match(source,/const alreadyPinned=approvedPeers\?\.some/);
 assert.match(source,/const canRequest=easyEnabled&&approvedPeers!==null&&!alreadyPinned&&recent/);
 assert.match(source,/if\(canRequest&&!alreadyPinned\)void sendNativeInbox/);
 assert.match(source,/easyEnabled&&!canRequest&&!canSelectPinned/);
 assert.match(source,/alreadyPinned\?"mesh\.stage4x\.alreadyPaired"/);
 assert.match(source,/if\(canSelectPinned\)\{setLanQaConsent\(false\);setLanQaResult\(null\);\}/);
});
test("connection status never conflates local pairing with live network or remote access",()=>{
 const source=readFileSync(new URL("../src/components/MeshConnectionCard.tsx",import.meta.url),"utf8");
 assert.match(source,/data-ready=\{locallyPaired\?"yes":"no"\}/);
 assert.equal((source.match(/data-ready="no"/g)||[]).length,2);
 assert.match(source,/mesh\.stage4x\.notOnline/);
 assert.match(source,/mesh\.stage4x\.locked/);
 assert.match(source,/channelStillActive!==false/);
 assert.match(source,/remoteJobsEnabled!==false/);
 assert.match(source,/crossDeviceWrites!==false/);
});
test("all four locales distinguish local pairing, live tunnel and remote control",()=>{
 for(const code of ["de","en","ru","es"]){
  const txt=readFileSync(new URL("../src/i18n/locales/"+code+".ts",import.meta.url),"utf8");
  for(const key of ["heading","local","paired","notPaired","localHint","tunnel","notOnline","tunnelHint","control","locked","controlHint","selectPaired","selectedPaired","alreadyPaired","pickPaired","qaSelected"]){
   assert.ok(txt.includes('"mesh.stage4x.'+key+'":'),code+" "+key);
   assert.equal(txt.includes('\\n  "mesh.stage4x.'),false,code+" escaped-linebreak");
  }
 }
});
