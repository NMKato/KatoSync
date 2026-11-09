// NMKato Solutions — Stage4G hardware QA signed recipient pinning.
// No actual pairing, Supabase access, real keychain or production trust grant.
import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createPublicKey} from "node:crypto";
import {mkdtempSync,writeFileSync,chmodSync,rmSync,symlinkSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {canonicalRecipientKey,sameApprovedRecipientKey,readPrivateRecipientFixture} from
 "../scripts/qa-mesh-synthetic-recipient-pin.mjs";

const identity=()=>{
 const {privateKey,publicKey}=generateKeyPairSync("ed25519");
 return {privateKey,raw:publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("base64url")};
};

test("strict 32-byte canonical Ed25519 recipient public key is required",()=>{
 const a=identity();
 assert.equal(canonicalRecipientKey(a.raw)?.length,32);
 for(const bad of ["",null,"A".repeat(44),"abc",a.raw+"==",
   a.raw.replace(/.$/,"$")," " +a.raw]){
  if(bad!==a.raw)assert.equal(canonicalRecipientKey(bad),null);
 }
});
test("registered public key accepts only the same independent identity",()=>{
 const a=identity(),b=identity();
 assert.equal(sameApprovedRecipientKey(a.raw,a.raw),true);
 assert.equal(sameApprovedRecipientKey(b.raw,a.raw),false);
 assert.equal(sameApprovedRecipientKey("malformed",a.raw),false);
 assert.equal(sameApprovedRecipientKey(a.raw,undefined),false);
});
test("only an isolated, 0600, temporary Ed25519 client fixture can be loaded",()=>{
 if(process.platform==="win32")return;
 const dir=mkdtempSync("/tmp/ksmesh2uclient.");
 const path=join(dir,"key.pem"),i=identity();
 try{
  writeFileSync(path,i.privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600});
  const got=readPrivateRecipientFixture(path);
  assert.equal(got.publicRaw,i.raw);
  assert.equal(got.privateKey.asymmetricKeyType,"ed25519");
  chmodSync(path,0o644);
  assert.throws(()=>readPrivateRecipientFixture(path),
   /MESH_TWO_HOST_QA_DISPOSABLE_RECIPIENT_KEY_REQUIRED/);
  chmodSync(path,0o600);
  assert.throws(()=>readPrivateRecipientFixture("/tmp/key.pem"),
   /MESH_TWO_HOST_QA_DISPOSABLE_RECIPIENT_KEY_REQUIRED/);
  assert.throws(()=>readPrivateRecipientFixture(dir),
   /MESH_TWO_HOST_QA_DISPOSABLE_RECIPIENT_KEY_REQUIRED/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("wrong algorithm and symlinks never become a QA recipient identity",()=>{
 if(process.platform==="win32")return;
 const dir=mkdtempSync("/tmp/ksmesh2uclient.");
 const key=join(dir,"key.pem"),backup=join(dir,"saved.pem");
 try{
  const i=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  writeFileSync(key,i.privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600});
  assert.throws(()=>readPrivateRecipientFixture(key),
    /MESH_TWO_HOST_QA_DISPOSABLE_RECIPIENT_KEY_REQUIRED/);
  rmSync(key);
  writeFileSync(backup,identity().privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600});
  symlinkSync(backup,key);
  assert.throws(()=>readPrivateRecipientFixture(key),
    /MESH_TWO_HOST_QA_DISPOSABLE_RECIPIENT_KEY_REQUIRED/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("hardware server demands separate recipient pin before opening TLS port",()=>{
 const s=readFileSync(new URL("../scripts/qa-mesh-two-host-signed-invite.mjs",import.meta.url),"utf8");
 assert.match(s,/MESH_TWO_HOST_BLOCKED/);
 assert.match(s,/RECIPIENT_PUBLIC_KEY_PIN_REQUIRED/);
 assert.match(s,/sameApprovedRecipientKey\(recipientPublic,approvedRecipientPin\)/);
 assert.match(s,/MESH_TWO_HOST_UNAPPROVED_RECIPIENT_PIN_REJECTED/);
 assert.match(s,/readPrivateRecipientFixture\(/);
 assert.match(s,/MESH_TWO_HOST_BAD_DEVICE_SIGNATURE/);
 assert.match(s,/paired:false,transportReady:false,remoteJobsEnabled:false/);
 assert.doesNotMatch(s,/KATOSYNC_MESH_LAN_QA_REAL_TOKEN/);
});
test("no default QA recipient identity is accepted silently",()=>{
 const s=readFileSync(new URL("../scripts/qa-mesh-two-host-signed-invite.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(s,/const recipient=generateKeyPairSync\\("ed25519"\\)/);
 assert.match(s,/KATOSYNC_MESH_LAN_QA_EXPECTED_RECIPIENT_KEY/);
 assert.match(s,/KATOSYNC_MESH_LAN_QA_RECIPIENT_KEY_PATH/);
});
