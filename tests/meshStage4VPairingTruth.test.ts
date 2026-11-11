// Created by NMKato Solutions — Stage4V pairing-state truth and transport isolation tests.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deriveLocalPairingStatus} from "../src/lib/meshPairingStatus4V.ts";

const ui=readFileSync(new URL("../src/components/MeshConnectionCard.tsx",import.meta.url),"utf8");
const pin={fingerprint:"AA-BB-CC-DD-EE-FF-00-11-22-33-44-55-66-77-88-99",
  status:"locally_approved" as const, approvedAt:1800000000,publicKey:"PUBLIC_FIXTURE_ONLY"};
const me={fingerprint:"12-34-56-78-90-AB-CD-EF-11-22-33-44-55-66-77-88",
  ownerUserId:"owner-a",membershipState:"discovered"};
const other={fingerprint:pin.fingerprint,ownerUserId:"owner-a",membershipState:"discovered"};
const base={
 pins:[pin],devices:[me,other],ownFingerprint:me.fingerprint,
 transport:"not_connected",remoteReadOnlyDispatch:false,crossDeviceWrites:false
} as const;

test("only a native locally approved key matching an active same-account roster peer is paired",()=>{
 assert.equal(deriveLocalPairingStatus(base),"locally_paired");
 assert.equal(deriveLocalPairingStatus({...base,pins:[]}),"not_paired");
 assert.equal(deriveLocalPairingStatus({...base,pins:null}),"checking");
 assert.equal(deriveLocalPairingStatus({...base,devices:null}),"checking");
 assert.equal(deriveLocalPairingStatus({...base,ownFingerprint:null}),"checking");
 assert.equal(deriveLocalPairingStatus({...base,transport:null}),"checking");
});
test("cross-account, self-pin, wrong key, revoked or stale roster never show pairing",()=>{
 for(const bad of [
  {devices:[me,{...other,ownerUserId:"owner-b"}]},
  {devices:[me,{...other,membershipState:"revoked"}]},
  {devices:[me]},
  {devices:[me,{...other,fingerprint:"AA-AA-AA-AA-AA-AA-AA-AA-AA-AA-AA-AA-AA-AA-AA-AA"}]},
  {pins:[{...pin,fingerprint:me.fingerprint}]},
  {pins:[{...pin,approvedAt:0}]},
  {pins:[{...pin,status:"revoked" as const}]}
 ]) assert.notEqual(deriveLocalPairingStatus({...base,...bad} as typeof base),"locally_paired");
});
test("transport and job authorization are NEVER inferred from a pin or a roster",()=>{
 assert.equal(deriveLocalPairingStatus({...base,transport:"connected"}),"checking");
 assert.equal(deriveLocalPairingStatus({...base,remoteReadOnlyDispatch:true}),"checking");
 assert.equal(deriveLocalPairingStatus({...base,crossDeviceWrites:true}),"checking");
 assert.match(ui,/peerTransport!==\"not_connected\"/);
 assert.match(ui,/remoteReadOnlyDispatch \|\| actual\.crossDeviceWrites/);
});
test("native Keychain read-only command loads on refresh and invalidates on reauthentication",()=>{
 assert.match(ui,/invoke<MeshPeerInventory>\("mesh_local_approved_peers"\)\.catch\(\(\)=>null\)/);
 assert.match(ui,/const request=\+\+trustReadEpoch\.current/);
 assert.match(ui,/if\(request!==trustReadEpoch\.current\)return/);
 assert.match(ui,/trustReadEpoch\.current\+\+;setApprovedPeers\(null\)/);
 assert.match(ui,/setApprovedPeers\(pinInventoryValid\?pins\.peers:null\)/);
});
test("pinned status distinguishes locally paired from actual transport, including after restart",()=>{
 assert.match(ui,/deriveLocalPairingStatus\(\{/);
 assert.match(ui,/locallyPaired\?t\("mesh\.status\.locallyPaired"\)/);
 assert.match(ui,/locallyPaired\?t\("mesh\.status\.noTransport"\)/);
 assert.match(ui,/locallyPaired\|\|easyStage==="approved"/);
 assert.match(ui,/data-pairing-status=\{pairingStatus\}/);
 assert.match(ui,/locallyPaired\?"mesh\.status\.helloBlocked"/);
});
test("all supported languages describe local pairing and unavailable tunnel honestly",()=>{
 for(const locale of ["de","en","ru","es"]){
  const i18n=readFileSync(new URL("../src/i18n/locales/"+locale+".ts",import.meta.url),"utf8");
  for(const key of [
   "mesh.status.locallyPaired","mesh.status.noTransport",
   "mesh.status.checking","mesh.status.helloBlocked"
  ]) assert.ok(i18n.includes('"'+key+'":'),locale+"/"+key);
 }
});
