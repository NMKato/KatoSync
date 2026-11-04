import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {canConfirmRelayPeerLocally,type RelaySasProof} from "../src/lib/meshRelayLocalApproval35F.ts";

const fingerprint=Array.from({length:16},(_,i)=>i.toString(16).padStart(2,"0").toUpperCase()).join("-");
const otherFingerprint=Array.from({length:16},(_,i)=>(i+1).toString(16).padStart(2,"0").toUpperCase()).join("-");
const proof:RelaySasProof={fingerprint,comparisonCode:"AB12-34CD-EF09",
  paired:false,peerCount:0,transportReady:false};
const candidate={proof,selectedPeer:{fingerprint,membershipState:"discovered" as const},
  codeFromOtherDevice:"AB12-34CD-EF09",busy:false};

test("relay SAS local approval appears only after exact selected public key and manually typed code",()=>{
  assert.equal(canConfirmRelayPeerLocally(candidate),true);
  assert.equal(canConfirmRelayPeerLocally({...candidate,selectedPeer:{fingerprint,membershipState:"pending"}}),true);
});
test("a wrong device or missing selection cannot be locally pinned",()=>{
  assert.equal(canConfirmRelayPeerLocally({...candidate,selectedPeer:null}),false);
  assert.equal(canConfirmRelayPeerLocally({...candidate,selectedPeer:{fingerprint:otherFingerprint,membershipState:"discovered"}}),false);
  assert.equal(canConfirmRelayPeerLocally({...candidate,proof:{...proof,fingerprint:otherFingerprint}}),false);
});
test("mistyped and missing SAS cannot be submitted even if the signed proof is present",()=>{
  for(const code of ["","AB12-34CD-EF08","ab12-34cd-ef09","AB12-34CD-EF09 ","0000","AB12-34CD-EF090"]){
    assert.equal(canConfirmRelayPeerLocally({...candidate,codeFromOtherDevice:code}),false,code);
  }
});
test("revoked, untrusted or already paired state cannot bypass local confirmation",()=>{
  for(const membershipState of ["trusted","revoked"] as const){
    assert.equal(canConfirmRelayPeerLocally({...candidate,selectedPeer:{fingerprint,membershipState}}),false);
  }
  assert.equal(canConfirmRelayPeerLocally({...candidate,busy:true}),false);
  assert.equal(canConfirmRelayPeerLocally({...candidate,proof:{...proof,paired:true}}),false);
  assert.equal(canConfirmRelayPeerLocally({...candidate,proof:{...proof,transportReady:true}}),false);
  assert.equal(canConfirmRelayPeerLocally({...candidate,proof:{...proof,peerCount:1}}),false);
  assert.equal(canConfirmRelayPeerLocally({...candidate,proof:null}),false);
});
test("only explicit click invokes native trust pin, never after automatic relay verification",()=>{
 const src=readFileSync(new URL("../src/components/MeshConnectionCard.tsx",import.meta.url),"utf8");
 const area=src.slice(src.indexOf("{relayProof?<div"),src.indexOf("{relayError?<p",src.indexOf("{relayProof?<div")));
 assert.ok(area.includes("disabled={!relayApprovalEligible}"));
 assert.ok(area.includes("onClick={()=>void approvePeer()}"));
 assert.ok(area.includes("setConfirmedCode(e.target.value.toUpperCase())"));
 assert.ok(area.includes('t("mesh.relay.localOnly")'));
 assert.ok(src.includes('invoke<MeshPeerInventory>("mesh_local_approve_peer"'));
 const relay=src.slice(src.indexOf("const prepareRelayResponse=async"),src.indexOf("const selectedDevice="));
 assert.ok(!relay.includes("mesh_local_approve_peer"));
 assert.ok(!relay.includes("mesh_local_revoke_peer"));
});
test("DE, EN, ES, RU disclose that local key approval is not mTLS or remote jobs",()=>{
 for(const lang of ["de","en","es","ru"]){
  const text=readFileSync(new URL("../src/i18n/locales/"+lang+".ts",import.meta.url),"utf8");
  for(const key of ["mesh.relay.target","mesh.relay.selectVerifiedPeer","mesh.relay.localOnly"]){
    assert.ok(text.includes('"'+key+'":'),lang+" "+key);
  }
 }
});
