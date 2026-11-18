import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto,randomBytes,createHash} from "node:crypto";
import {
 PROOF_PROTOCOL40,ownerProofBytes40,verifyOwnerKeyPossession40,
 type AdminKeyChallenge40,type OwnerKeyPossession40
} from "../src/lib/featureOwnerKeyProof40.ts";

const UID="11111111-1111-4111-8111-111111111111";
const OTHER_UID="22222222-2222-4222-8222-222222222222";
const NOW=Date.UTC(2026,10,5,8,0,0);
const b64=(b:Uint8Array)=>Buffer.from(b).toString("base64url");
async function setup(){
 const owner=await webcrypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const publicKeyBase64Url=b64(new Uint8Array(await webcrypto.subtle.exportKey("raw",owner.publicKey)));
 const challenge:AdminKeyChallenge40={
  protocol:"katosync.owner-key-challenge/v1",
  projectId:"katosync",subjectUid:UID,nonce:b64(randomBytes(32)),
  issuedAtMs:NOW-20000,expiresAtMs:NOW+60000
 };
 const proof:OwnerKeyPossession40={
  protocol:PROOF_PROTOCOL40,projectId:"katosync",subjectUid:UID,
  nonce:challenge.nonce,publicKeyBase64Url,signedAtMs:NOW-5000,signature:""
 };
 const sign=async(p:OwnerKeyPossession40)=>{
  const msg=ownerProofBytes40(p);
  const signature=await webcrypto.subtle.sign("Ed25519",owner.privateKey,
    new Uint8Array(msg).buffer as ArrayBuffer);
  return {...p,signature:b64(new Uint8Array(signature))};
 };
 return {challenge,proof:await sign(proof),sign,publicKeyBase64Url,owner};
}
test("owner signs a separate time-bound administrative challenge; only key ID returned",async()=>{
 const {challenge,proof,publicKeyBase64Url}=await setup();
 const result=await verifyOwnerKeyPossession40(proof,challenge,"katosync",UID,NOW);
 assert.deepEqual(result,{ownerKeyId:"ed25519-sha256:"+
   createHash("sha256").update(Buffer.from(publicKeyBase64Url,"base64url")).digest("hex")});
 assert.equal("grantsRights" in (result??{}),false);
});
test("identity, project, nonce and signature tampering cannot enroll another owner",async()=>{
 const {challenge,proof,sign}=await setup();
 const variants:unknown[]=[
  {...proof,projectId:"another"},
  {...proof,subjectUid:OTHER_UID},
  {...proof,signature:b64(randomBytes(64))},
  {...proof,nonce:b64(randomBytes(32))},
  {...proof,unknownField:"approved"},
  {...proof,publicKeyBase64Url:b64(randomBytes(32))},
  {...proof,protocol:"owner-yes"}
 ];
 for(const variant of variants){
  assert.equal(await verifyOwnerKeyPossession40(variant,challenge,"katosync",UID,NOW),null);
 }
 assert.equal(await verifyOwnerKeyPossession40(proof,{...challenge,nonce:b64(randomBytes(32))},
  "katosync",UID,NOW),null);
 const wrongIssuer=await sign({...proof,subjectUid:OTHER_UID});
 assert.equal(await verifyOwnerKeyPossession40(wrongIssuer,challenge,"katosync",UID,NOW),null);
});
test("expired, not-yet-issued and overly long admin challenges fail closed",async()=>{
 const {challenge,proof,sign}=await setup();
 for(const changed of [
  {...challenge,expiresAtMs:NOW-1},
  {...challenge,issuedAtMs:NOW+20000},
  {...challenge,expiresAtMs:NOW+1000000},
  {...challenge,nonce:"a"},
  {...challenge,state:"approved"}
 ]){
  assert.equal(await verifyOwnerKeyPossession40(proof,changed,"katosync",UID,NOW),null);
 }
 const late=await sign({...proof,signedAtMs:NOW+20000});
 assert.equal(await verifyOwnerKeyPossession40(late,challenge,"katosync",UID,NOW),null);
 const early=await sign({...proof,signedAtMs:challenge.issuedAtMs-1});
 assert.equal(await verifyOwnerKeyPossession40(early,challenge,"katosync",UID,NOW),null);
});
