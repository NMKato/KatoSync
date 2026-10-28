import {test} from "node:test";
import assert from "node:assert/strict";
import {meshOwnerTopic,parseMeshSignalEnvelope} from "../src/lib/meshRealtimeEnvelope.ts";
const owner="11111111-1111-4111-8111-111111111111";
const foreign="22222222-2222-4222-8222-222222222222";
const m2="33333333-3333-4333-8333-333333333333";
const m3="44444444-4444-4444-8444-444444444444";
const now=1793170000;
const signedMessage={
 protocol:"katosync-mesh-pairing-v1",publicKey:"A".repeat(43),
 nonce:"B".repeat(43),signature:"C".repeat(86),
 accountScope:"D".repeat(43),expiresAt:now+120
};
const offer={
 protocol:"katosync-mesh-signal-v1",kind:"offer",
 ownerId:owner,senderDeviceId:m2,targetDeviceId:m3,
 sentAt:now,expiresAt:now+120,signedMessage
};
const check=(value:unknown)=>parseMeshSignalEnvelope(value,owner,m3,now);
test("topic must be exact canonical owner UUID",()=>{
 assert.equal(meshOwnerTopic(owner),"katosync-mesh-owner:v1:"+owner);
 for(const x of ["",owner+"-suffix","../../","AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",foreign+":join"])
  assert.equal(meshOwnerTopic(x),null);
});
test("valid bounded public signed offer is transport only",()=>{
 const parsed=check(offer);
 assert.equal(parsed?.kind,"offer");
 assert.ok(parsed!==null);
 assert.ok(!Object.keys(parsed).includes("trusted"));
});
test("foreign account, wrong target, self-message and replay fail closed",()=>{
 assert.equal(check({...offer,ownerId:foreign}),null);
 assert.equal(check({...offer,targetDeviceId:m2}),null);
 assert.equal(check({...offer,senderDeviceId:m3}),null);
 assert.equal(parseMeshSignalEnvelope(offer,owner,m3,now+121),null);
 assert.equal(check({...offer,sentAt:now+11}),null);
});
test("strict version, protocol, key length and excessive payload are rejected",()=>{
 assert.equal(check({...offer,protocol:"katosync-mesh-signal-v0"}),null);
 assert.equal(check({...offer,unexpected:true}),null);
 assert.equal(check({...offer,signedMessage:{...signedMessage,publicKey:"bad"}}),null);
 assert.equal(check({...offer,signedMessage:{...signedMessage,protocol:"unknown"}}),null);
 assert.equal(check({...offer,signedMessage:{...signedMessage,padding:"x".repeat(9000)}}),null);
});
test("recursive secret-bearing envelope is never passed on",()=>{
 for(const key of ["access_token","refreshToken","password","privateKey","seed","authorization"]){
  assert.equal(check({...offer,signedMessage:{...signedMessage,nested:{[key]:"do-not-ship"}}}),null,key);
 }
 assert.equal(check({...offer,signedMessage:{...signedMessage,nested:Array(8).fill({payload:{x:1}})}}),null);
});
test("unknown presence and unauthenticated transport cannot masquerade as pairing",()=>{
 assert.equal(check({...offer,kind:"presence"}),null);
 assert.equal(check({...offer,signedMessage:{...signedMessage,paired:true,remoteJobsEnabled:true}}),null);
 assert.equal(check({kind:"offer"}),null);
});
test("nested challenge and response allow public typed signatures only",()=>{
 const challenge={
  protocol:"katosync-mesh-challenge-v1",offer:signedMessage,
  responderPublicKey:"E".repeat(43),responderNonce:"F".repeat(43),
  expiresAt:now+120,signature:"G".repeat(86)
 };
 const c={...offer,kind:"challenge",signedMessage:challenge};
 assert.equal(check(c)?.kind,"challenge");
 const response={protocol:"katosync-mesh-response-v1",challenge,signature:"H".repeat(86)};
 const r={...offer,kind:"response",signedMessage:response};
 assert.equal(check(r)?.kind,"response");
 assert.equal(check({...c,signedMessage:{...challenge,remoteJobsEnabled:true}}),null);
 assert.equal(check({...r,signedMessage:{...response,challenge:{...challenge,offer:{...signedMessage,paired:true}}}}),null);
 assert.equal(check({...r,signedMessage:{...response,challenge:{...challenge,responderPublicKey:"bad"}}}),null);
});
test("malformed event, invalid timestamps or spoofed rights are always rejected",()=>{
 assert.equal(check({...offer,signedMessage:{...signedMessage,privateKey:"x"}}),null);
 assert.equal(check({...offer,signedMessage:{...signedMessage,transportReady:true}}),null);
 assert.equal(check({...offer,sentAt:now-400}),null);
 assert.equal(check({...offer,expiresAt:now+400}),null);
 assert.equal(check({...offer,signedMessage:{...signedMessage,expiresAt:now+119}}),null);
 assert.equal(check({...offer,kind:"response",signedMessage}),null);
});
