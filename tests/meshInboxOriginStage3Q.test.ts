// Stage 3Q: real Rust Ed25519 signed public fixture; no private keys in JS.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {parseSendV2,parseRecipientV2,verifySendV2,verifyRecipientV2,
 INBOX_RECEIVE_V2,LIST_SENTINEL} from
 "../supabase/functions/mesh-inbox-preview/protocol.ts";
const file=new URL("./fixtures/meshInboxRustV2Stage3Q.public.json",import.meta.url);
const raw=readFileSync(file,"utf8");
const f=JSON.parse(raw);
const LIVE="https://xbnnlyyxiilklsygxcof.supabase.co";
const QA="https://abcdefghijklmnopqrst.supabase.co";
const otherDevice="44444444-4444-4444-8444-444444444444";
const send=(payload:unknown=f.send,origin=QA,owner=f.owner,key=f.sourcePublicKey,now=f.nowMs)=>
 verifySendV2(payload,owner,origin,key,now);
const recipient=(payload:unknown=f.recipient,origin=QA,owner=f.owner,key=f.targetPublicKey,now=f.nowMs)=>
 verifyRecipientV2(payload,owner,origin,key,now);
test("Rust-signed fixture is public only and parsed strictly",()=>{
 assert.equal(f.fixtureOnly,true);
 assert.equal(f.generatedBy,"rust-ed25519-serde-test");
 assert.equal(f.origin,QA);
 assert.deepEqual(parseSendV2(f.send),f.send);
 assert.deepEqual(parseRecipientV2(f.recipient),f.recipient);
 assert.equal(f.recipient.requestId,LIST_SENTINEL);
 assert.doesNotMatch(raw,/privateKey|secretKey|signingSeed|refresh_token|service_role|password/i);
});
test("real Rust send and recipient Ed25519 proofs both pass Edge WebCrypto for exact QA issuer",async()=>{
 assert.equal(await send(),true);
 assert.equal(await recipient(),true);
});
test("cross-tenant cloned proof, owner and source key fail",async()=>{
 assert.equal(await send(f.send,LIVE),false);
 assert.equal(await recipient(f.recipient,LIVE),false);
 assert.equal(await send({...f.send,origin:LIVE},LIVE),false);
 assert.equal(await recipient({...f.recipient,origin:LIVE},LIVE),false);
 assert.equal(await send(f.send,QA,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),false);
 assert.equal(await recipient(f.recipient,QA,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),false);
 assert.equal(await send(f.send,QA,f.owner,f.targetPublicKey),false);
 assert.equal(await recipient(f.recipient,QA,f.owner,f.sourcePublicKey),false);
});
test("send v2 rejects altered recipient, source, signed offer, nonce, expiry or signature",async()=>{
 const cases=[
  {...f.send,sourceDeviceId:otherDevice},
  {...f.send,targetDeviceId:otherDevice},
  {...f.send,dispatchSignature:"A".repeat(86)},
  {...f.send,signedOffer:{...f.send.signedOffer,nonce:"A".repeat(43)}},
  {...f.send,signedOffer:{...f.send.signedOffer,expiresAt:f.send.signedOffer.expiresAt+4}},
  {...f.send,signedOffer:{...f.send.signedOffer,signature:"A".repeat(86)}},
 ];
 for(const c of cases)assert.equal(await send(c),false);
 assert.equal(await send(f.send,QA,f.owner,f.sourcePublicKey,f.nowMs+400000),false);
});
test("recipient v2 denies changed action, device, request, nonce, expiry and signature",async()=>{
 const cases=[
  {...f.recipient,action:"accept",requestId:otherDevice},
  {...f.recipient,action:"reject",requestId:otherDevice},
  {...f.recipient,deviceId:otherDevice},
  {...f.recipient,nonce:"A".repeat(43)},
  {...f.recipient,expiresAt:f.recipient.expiresAt+3},
  {...f.recipient,signature:"A".repeat(86)},
  {...f.recipient,protocol:"katosync-mesh-inbox-recipient-v1"},
 ];
 for(const c of cases)assert.equal(await recipient(c),false);
 assert.equal(await recipient(f.recipient,QA,f.owner,f.targetPublicKey,f.nowMs+120000),false);
});
test("parser denies unknown fields, malformed origins and list sentinel/action downgrades",()=>{
 assert.equal(parseSendV2({...f.send,extra:true}),null);
 assert.equal(parseRecipientV2({...f.recipient,extra:true}),null);
 assert.equal(parseRecipientV2({...f.recipient,action:"accept"}),null);
 assert.equal(parseRecipientV2({...f.recipient,requestId:otherDevice}),null);
 assert.equal(parseSendV2({...f.send,origin:QA+"/auth/v1"}),null);
 assert.equal(parseRecipientV2({...f.recipient,origin:QA+".evil.test"}),null);
 assert.equal(parseSendV2({...f.send,protocol:"katosync-mesh-inbox-send-v1"}),null);
 assert.equal(parseRecipientV2({...f.recipient,origin:LIVE}),null);
});
test("existing source hashes remain exact",()=>{
 const expected={
  "mesh-inbox-send/send.ts":"74d27e69f91140fba8141b55d7bef1f6d96bf7c83226b1df81d4c5d03bd103ba",
  "mesh-inbox-receive/receive.ts":"bd76bbf3fa5c530760b510259f7a4f927c406f0d3c94aaf3e3fdd66dc4f4d099",
  "mesh-device-enrollment/membership-gate.ts":"a51592178bd4a899b31686125f807836c0fed35de41453f820f459f95bf45f0c"
 };
 for(const [name,want] of Object.entries(expected)){
  const data=readFileSync(new URL("../supabase/functions/"+name,import.meta.url));
  assert.equal(createHash("sha256").update(data).digest("hex"),want,name);
 }
});
