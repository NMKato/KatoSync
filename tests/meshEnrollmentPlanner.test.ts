// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {planMeshEnrollment,type MeshCandidateView,type MeshOwnerPolicyView} from "../src/lib/meshEnrollmentPlanner.ts";

const policy:MeshOwnerPolicyView={
  accountScope:"issuer:verified-user-hash",mode:"auto",verifiedOwnerOptIn:true,
  expiresAtMs:10_000_000,maxDevices:10
};
const device:MeshCandidateView={
  deviceId:"ed25519-public-identity-A",accountScope:policy.accountScope,
  issuerVerified:true,deviceProofVerified:true,revoked:false,locallyTrusted:false,
  freshPasskeyVerified:true,passkeyBoundToDevice:true
};
const result=(p:Partial<MeshOwnerPolicyView>={}, d:Partial<MeshCandidateView>={}, count=2)=>
  planMeshEnrollment({...policy,...p},{...device,...d},count,1_000);
test("opted-in owner can plan new device auto enrollment after strong bound passkey proof",()=>{
 const x=result();assert.equal(x.outcome,"auto_enroll_candidate");assert.equal(x.reason,"auto_mode_eligible");
 assert.deepEqual(x.authorizedCapabilities,[]);assert.equal(x.nativeApprovalRequired,true);
});
test("already approved peer can rejoin automatically without a fresh passkey",()=>{
 assert.equal(result({}, {locallyTrusted:true,freshPasskeyVerified:false,passkeyBoundToDevice:false}).outcome,"auto_reconnect_candidate");
});
test("same account or copied login by itself cannot silently join",()=>{
 assert.equal(result({mode:"manual"}).outcome,"manual_approval");
 assert.equal(result({verifiedOwnerOptIn:false}).outcome,"manual_approval");
 assert.equal(result({}, {freshPasskeyVerified:false}).reason,"fresh_passkey_required");
 assert.equal(result({}, {passkeyBoundToDevice:false}).reason,"device_binding_required");
 assert.equal(result({}, {deviceProofVerified:false}).outcome,"blocked");
});
test("other account and revoked keys never enter the mesh",()=>{
 assert.equal(result({}, {accountScope:"different-account"}).reason,"wrong_account");
 assert.equal(result({}, {issuerVerified:false}).reason,"issuer_unverified");
 assert.equal(result({}, {revoked:true,locallyTrusted:true}).reason,"device_revoked");
 assert.equal(result({}, {deviceId:""}).reason,"no_device_proof");
});
test("policy expiration, peer quotas and malformed counts fail closed",()=>{
 assert.equal(result({expiresAtMs:999}).outcome,"manual_approval");
 assert.equal(result({}, {}, 10).reason,"device_limit");
 assert.equal(result({maxDevices:11}).reason,"invalid_policy");
 assert.equal(result({}, {}, -1).reason,"invalid_policy");
});
test("only a UI planner: never invokes hidden enrollment/network/remote rights",()=>{
 const source=readFileSync(new URL("../src/lib/meshEnrollmentPlanner.ts",import.meta.url),"utf8");
 for(const forbidden of ["fetch(","WebSocket","TcpListener","invoke(","set_password","save_supabase","remote_task_execute"])
  assert.ok(!source.includes(forbidden),"side effect introduced: "+forbidden);
});
