// NMKato Solutions — Stage 3J: actual Rust ed25519-dalek + serde bytes
// validated against the real TypeScript/WebCrypto Edge contract. No Cloud calls.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  verifyRelayEnvelope, verifyRelayListProof, parseRelayEnvelope, parseRelayListProof,
} from "../supabase/functions/mesh-pairing-relay/protocol.ts";
import type {RelayEnvelope,RelayInvite,RelayListProof} from "../supabase/functions/mesh-pairing-relay/protocol.ts";

type RustFixture={
 generatedBy:string;fixtureOnly:true;owner:string;nowMs:number;
 requestId:string;sourceDeviceId:string;targetDeviceId:string;
 sourcePublicKey:string;targetPublicKey:string;invite:RelayInvite;
 challenge:RelayEnvelope;response:RelayEnvelope;
 listInitiator:RelayListProof;listRecipient:RelayListProof;
};
const fixtureInput=process.env.KATOSYNC_STAGE3J_RUST_FIXTURE;
const f=JSON.parse(readFileSync(fixtureInput??new URL(
  "./fixtures/meshRelayRustEd25519Stage3J.public.json",import.meta.url),"utf8")) as RustFixture;
const b64=(bytes:Uint8Array)=>Buffer.from(bytes).toString("base64url");
const b64Dec=(txt:string)=>Buffer.from(txt,"base64url");
const reverse=(obj:unknown):unknown=>{
 if(Array.isArray(obj))return obj.map(reverse);
 if(obj&&typeof obj==="object")
   return Object.fromEntries(Object.entries(obj).reverse().map(([k,v])=>[k,reverse(v)]));
 return obj;
};
test("public-only artifact was serialized and signed in Rust, never from test JS private keys",()=>{
 assert.equal(f.generatedBy,"rust-production-ed25519-dalek-serde");
 assert.equal(f.fixtureOnly,true);
 assert.match(f.owner,/^[0-9a-f-]{36}$/);
 assert.equal(f.invite.state,"accepted");
 assert.equal(f.invite.request_id,f.requestId);
 assert.ok(f.invite.signed_offer);
 const raw=readFileSync(fixtureInput??new URL("./fixtures/meshRelayRustEd25519Stage3J.public.json",import.meta.url),"utf8");
 assert.doesNotMatch(raw,/privateKey|secretKey|signingSeed|refresh_token|service_role|password/i);
});
test("real RUST-signed Challenge B→A, Response A→B and recipient list proofs pass actual EDGE WebCrypto",async()=>{
 const c=parseRelayEnvelope(f.challenge),r=parseRelayEnvelope(f.response);
 assert.ok(c);assert.ok(r);
 assert.equal(await verifyRelayEnvelope(c,f.owner,f.sourcePublicKey,f.targetPublicKey,f.invite,f.nowMs),true);
 assert.equal(await verifyRelayEnvelope(r,f.owner,f.sourcePublicKey,f.targetPublicKey,f.invite,f.nowMs),true);
 assert.deepEqual(parseRelayListProof(f.listInitiator),f.listInitiator);
 assert.deepEqual(parseRelayListProof(f.listRecipient),f.listRecipient);
 assert.equal(await verifyRelayListProof(f.listInitiator,f.owner,f.sourcePublicKey,f.nowMs),true);
 assert.equal(await verifyRelayListProof(f.listRecipient,f.owner,f.targetPublicKey,f.nowMs),true);
});
test("Postgres JSONB reordering of stored invitation does NOT corrupt signed Rust transcript",async()=>{
 const db={...f.invite,signed_offer:reverse(f.invite.signed_offer)};
 assert.equal(await verifyRelayEnvelope(f.challenge,f.owner,f.sourcePublicKey,f.targetPublicKey,db,f.nowMs),true);
 assert.equal(await verifyRelayEnvelope(f.response,f.owner,f.sourcePublicKey,f.targetPublicKey,db,f.nowMs),true);
});
test("real Rust signatures reject altered owner, direction, original offer, payload and expiry",async()=>{
 const accepted=(m:RelayEnvelope,inv=f.invite,owner=f.owner)=>
  verifyRelayEnvelope(m,owner,f.sourcePublicKey,f.targetPublicKey,inv,f.nowMs);
 assert.equal(await accepted({...f.challenge,kind:"response"}),false);
 assert.equal(await accepted({...f.response,recipientDeviceId:f.sourceDeviceId}),false);
 assert.equal(await accepted({...f.challenge,signature:b64(new Uint8Array(64))}),false);
 assert.equal(await accepted({...f.response,payloadB64:b64(Buffer.from("{}"))}),false);
 assert.equal(await accepted(f.challenge,{...f.invite,state:"pending"}),false);
 assert.equal(await accepted(f.challenge,{...f.invite,owner_user_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}),false);
 assert.equal(await accepted(f.challenge,f.invite,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),false);
 assert.equal(await accepted({...f.challenge,expiresAt:Math.floor(f.nowMs/1000)-1}),false);
 assert.equal(await verifyRelayEnvelope(f.challenge,f.owner,f.targetPublicKey,f.sourcePublicKey,f.invite,f.nowMs),false);
 const inner=JSON.parse(b64Dec(f.challenge.payloadB64).toString("utf8"));
 inner.responderNonce="A".repeat(43);
 const modified={...f.challenge,payloadB64:b64(Buffer.from(JSON.stringify(inner)))};
 assert.equal(await accepted(modified),false);
});
test("real Rust read proof fails when its identity, scope, nonce or expiry is changed",async()=>{
 const p=f.listInitiator;
 assert.equal(await verifyRelayListProof({...p,nonce:"A".repeat(43)},f.owner,f.sourcePublicKey,f.nowMs),false);
 assert.equal(await verifyRelayListProof({...p,deviceId:f.targetDeviceId},f.owner,f.sourcePublicKey,f.nowMs),false);
 assert.equal(await verifyRelayListProof({...p,expiresAt:p.expiresAt+3},f.owner,f.sourcePublicKey,f.nowMs),false);
 assert.equal(await verifyRelayListProof(p,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",f.sourcePublicKey,f.nowMs),false);
 assert.equal(await verifyRelayListProof(p,f.owner,f.targetPublicKey,f.nowMs),false);
});
