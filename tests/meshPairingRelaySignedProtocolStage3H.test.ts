// NMKato Solutions – real WebCrypto Ed25519, no network or real KATOOS devices.
import {test} from "node:test";
import assert from "node:assert/strict";
import {accountScope,parseRelayEnvelope,parseRelayListProof,
 RELAY_PROTOCOL,RELAY_LIST_PROTOCOL,verifyRelayEnvelope,verifyRelayListProof,
 type RelayEnvelope,type RelayInvite} from "../supabase/functions/mesh-pairing-relay/protocol.ts";
const owner="11111111-1111-4111-8111-111111111111";
const src="22222222-2222-4222-8222-222222222222";
const dst="33333333-3333-4333-8333-333333333333";
const requestId="44444444-4444-4444-8444-444444444444";
const enc=new TextEncoder();
const b64=(a:Uint8Array)=>Buffer.from(a).toString("base64url");
const sig=async(k:CryptoKey,s:string)=>b64(new Uint8Array(await crypto.subtle.sign("Ed25519",k,enc.encode(s))));
const hash=async(s:string)=>b64(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s))));
const create=async()=>{
 const a=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const b=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const aPub=b64(new Uint8Array(await crypto.subtle.exportKey("raw",a.publicKey)));
 const bPub=b64(new Uint8Array(await crypto.subtle.exportKey("raw",b.publicKey)));
 const scope=await accountScope(owner),expiresAt=Math.floor(Date.now()/1000)+240;
 const offer={protocol:"katosync-mesh-pairing-v1",publicKey:aPub,
  nonce:b64(crypto.getRandomValues(new Uint8Array(32))),expiresAt,
  accountScope:scope,signature:""};
 offer.signature=await sig(a.privateKey,[offer.protocol,scope,aPub,offer.nonce,String(expiresAt)].join("|"));
 const challenge={protocol:"katosync-mesh-challenge-v1",offer,responderPublicKey:bPub,
  responderNonce:b64(crypto.getRandomValues(new Uint8Array(32))),expiresAt:expiresAt-5,signature:""};
 challenge.signature=await sig(b.privateKey,[challenge.protocol,await hash(JSON.stringify(offer)),
  scope,bPub,challenge.responderNonce,String(challenge.expiresAt)].join("|"));
 const response={protocol:"katosync-mesh-response-v1",challenge,
  signature:await sig(a.privateKey,["katosync-mesh-response-v1",await hash(JSON.stringify(challenge))].join("|"))};
 const invite:RelayInvite={request_id:requestId,owner_user_id:owner,source_device_id:src,target_device_id:dst,
  state:"accepted",expires_at:new Date(expiresAt*1000).toISOString(),signed_offer:offer};
 async function envelope(kind:"challenge"|"response",message:object):Promise<RelayEnvelope>{
  const p={protocol:RELAY_PROTOCOL,requestId,senderDeviceId:kind==="challenge"?dst:src,
   recipientDeviceId:kind==="challenge"?src:dst,kind,
   payloadB64:b64(enc.encode(JSON.stringify(message))),nonce:b64(crypto.getRandomValues(new Uint8Array(32))),
   expiresAt:expiresAt-8,signature:""};
  p.signature=await sig(kind==="challenge"?b.privateKey:a.privateKey,
   [p.protocol,owner,p.requestId,p.senderDeviceId,p.recipientDeviceId,p.kind,p.payloadB64,p.nonce,String(p.expiresAt)].join("|"));
  return p;
 }
 return {a,b,src, dst, aPub,bPub,offer,challenge,response,invite,envelope};
};
test("cryptographically valid, invitation-bound challenge and response relay",async()=>{
 const f=await create();
 const c=await f.envelope("challenge",f.challenge),r=await f.envelope("response",f.response);
 assert.equal(parseRelayEnvelope(c)?.requestId,requestId);
 assert.equal(await verifyRelayEnvelope(c,owner,f.aPub,f.bPub,f.invite),true);
 assert.equal(await verifyRelayEnvelope(r,owner,f.aPub,f.bPub,f.invite),true);
});
test("PostgreSQL JSONB reorders offer fields without breaking canonical Rust signatures",async()=>{
 const f=await create();
 const jsonbOffer=Object.fromEntries(Object.entries(f.offer).sort(([a],[b])=>a.localeCompare(b)));
 const invite={...f.invite,signed_offer:jsonbOffer};
 const challenge=await f.envelope("challenge",f.challenge);
 const response=await f.envelope("response",f.response);
 assert.equal(await verifyRelayEnvelope(challenge,owner,f.aPub,f.bPub,invite),true);
 assert.equal(await verifyRelayEnvelope(response,owner,f.aPub,f.bPub,invite),true);
});
test("reordered public challenge JSON does not bypass or falsely break inner signature",async()=>{
 const f=await create();
 const ordered=Object.fromEntries(Object.entries(f.challenge).reverse());
 const payloadB64=b64(enc.encode(JSON.stringify(ordered)));
 const orig=await f.envelope("challenge",f.challenge);
 const shuffled={...orig,payloadB64};
 shuffled.signature=await sig(f.b.privateKey,[shuffled.protocol,owner,requestId,shuffled.senderDeviceId,
  shuffled.recipientDeviceId,shuffled.kind,payloadB64,shuffled.nonce,String(shuffled.expiresAt)].join("|"));
 assert.equal(await verifyRelayEnvelope(shuffled,owner,f.aPub,f.bPub,f.invite),true);
});
test("relay denies wrong owner, swapped recipient, expired or pending invite",async()=>{
 const f=await create(),c=await f.envelope("challenge",f.challenge);
 assert.equal(await verifyRelayEnvelope(c,"99999999-9999-4999-8999-999999999999",f.aPub,f.bPub,f.invite),false);
 assert.equal(await verifyRelayEnvelope({...c,recipientDeviceId:dst},owner,f.aPub,f.bPub,f.invite),false);
 assert.equal(await verifyRelayEnvelope(c,owner,f.aPub,f.bPub,{...f.invite,state:"pending"}),false);
 assert.equal(await verifyRelayEnvelope(c,owner,f.aPub,f.bPub,{...f.invite,expires_at:new Date(Date.now()-1000).toISOString()}),false);
 assert.equal(await verifyRelayEnvelope({...c,expiresAt:Math.floor(Date.now()/1000)-10},owner,f.aPub,f.bPub,f.invite),false);
});
test("outer and inner signatures MUST BOTH verify; no opaque JSON passthrough",async()=>{
 const f=await create(),good=await f.envelope("challenge",f.challenge);
 assert.equal(await verifyRelayEnvelope({...good,signature:"A".repeat(86)},owner,f.aPub,f.bPub,f.invite),false);
 const wrongInner=await f.envelope("challenge",{...f.challenge,signature:"A".repeat(86)});
 assert.equal(await verifyRelayEnvelope(wrongInner,owner,f.aPub,f.bPub,f.invite),false);
 const response=await f.envelope("response",{...f.response,signature:"B".repeat(86)});
 assert.equal(await verifyRelayEnvelope(response,owner,f.aPub,f.bPub,f.invite),false);
 const wrongOffer=await f.envelope("challenge",{...f.challenge,offer:{...f.offer,nonce:"A".repeat(43)}});
 assert.equal(await verifyRelayEnvelope(wrongOffer,owner,f.aPub,f.bPub,f.invite),false);
});
test("strict relay envelope shape, size and role separation",async()=>{
 const f=await create(),c=await f.envelope("challenge",f.challenge);
 assert.equal(parseRelayEnvelope({...c,remoteJobsEnabled:true}),null);
 assert.equal(parseRelayEnvelope({...c,payloadB64:"X".repeat(12000)}),null);
 assert.equal(parseRelayEnvelope({...c,nonce:"*" }),null);
 assert.equal(parseRelayEnvelope({...c,senderDeviceId:c.recipientDeviceId}),null);
 assert.equal(await verifyRelayEnvelope({...c,kind:"response"},owner,f.aPub,f.bPub,f.invite),false);
 assert.equal(await verifyRelayEnvelope(c,owner,f.bPub,f.aPub,f.invite),false);
});
test("recipient read proof is Ed25519 device-bound, fresh and strict",async()=>{
 const f=await create(),expiry=Math.floor(Date.now()/1000)+65;
 const proof={protocol:RELAY_LIST_PROTOCOL,deviceId:dst,
  nonce:b64(crypto.getRandomValues(new Uint8Array(32))),expiresAt:expiry,signature:""};
 proof.signature=await sig(f.b.privateKey,[proof.protocol,owner,dst,proof.nonce,String(expiry)].join("|"));
 assert.deepEqual(parseRelayListProof(proof),proof);
 assert.equal(await verifyRelayListProof(proof,owner,f.bPub),true);
 assert.equal(await verifyRelayListProof({...proof,deviceId:src},owner,f.bPub),false);
 assert.equal(await verifyRelayListProof({...proof,nonce:"A".repeat(43)},owner,f.bPub),false);
 assert.equal(await verifyRelayListProof({...proof,expiresAt:Math.floor(Date.now()/1000)-5},owner,f.bPub),false);
 assert.equal(parseRelayListProof({...proof,unexpected:"network"}),null);
});
