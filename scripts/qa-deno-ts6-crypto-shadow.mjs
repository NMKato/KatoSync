// NMKato Solutions — Shadow-only Deno 2.9.x crypto BufferSource compatibility QA.
// Immutable SHA-pinned source never changes. No credentials, network or deploy.
// Copies the whole local functions directory to an ephemeral 0700 QA folder,
// changes ONLY 5 narrowed WebCrypto Uint8Array<ArrayBuffer> call-sites, checks
// FULL Deno TypeScript and compares authentic Ed25519 positive/negative vectors.
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const src=join(root,"supabase/functions");
const hashes={
 "mesh-inbox-send/send.ts":"74d27e69f91140fba8141b55d7bef1f6d96bf7c83226b1df81d4c5d03bd103ba",
 "mesh-pairing-relay/protocol.ts":"539751297e03ecc6303915aac3287c7bcbcc8cce0c0812a7e1f81e8c3550bcdb",
 "mesh-device-presence-qa/heartbeat.ts":"b4f2f13e89a560f8a1b5b509cb5ba0485170d55b71f9018e898702b50ff8dd51",
 "mesh-inbox-receive/receive.ts":"bd76bbf3fa5c530760b510259f7a4f927c406f0d3c94aaf3e3fdd66dc4f4d099",
};
for(const [name,expected] of Object.entries(hashes)){
 if(!expected)continue;
 const actual=createHash("sha256").update(readFileSync(join(src,name))).digest("hex");
 assert.equal(actual,expected,"original crypto code hash altered: "+name);
}
const tmp=mkdtempSync(join(tmpdir(),"katosync-deno-ts6-shadow-"));
const shadow=join(tmp,"functions");
function transform(name,replacements){
 const file=join(shadow,name);
 let txt=readFileSync(file,"utf8");
 const helper='\n// QA-SHADOW-ONLY: force a dedicated ArrayBuffer for WebCrypto BufferSource.\n'+
 'const qaCryptoBuffer=(src:Uint8Array):Uint8Array<ArrayBuffer>=>{\n'+
 ' const dst=new Uint8Array(new ArrayBuffer(src.byteLength));dst.set(src);return dst;\n};\n';
 for(const [from,to] of replacements){
  assert.equal(txt.split(from).length-1,1,"unexpected original crypto callsite: "+from);
  txt=txt.replace(from,to);
 }
 assert.equal((txt.match(/qaCryptoBuffer\(/g)||[]).length,replacements.length);
 txt+=helper;
 writeFileSync(file,txt);
}
try{
 cpSync(src,shadow,{recursive:true,errorOnExist:true,force:false});
 transform("mesh-inbox-send/send.ts",[
  ['crypto.subtle.importKey("raw",rawKey,','crypto.subtle.importKey("raw",qaCryptoBuffer(rawKey),'],
  ['crypto.subtle.verify("Ed25519",key,sig,','crypto.subtle.verify("Ed25519",key,qaCryptoBuffer(sig),'],
  ['crypto.subtle.verify("Ed25519",key,recipientSig,','crypto.subtle.verify("Ed25519",key,qaCryptoBuffer(recipientSig),']
 ]);
 transform("mesh-pairing-relay/protocol.ts",[
  ['crypto.subtle.importKey("raw",pub,','crypto.subtle.importKey("raw",qaCryptoBuffer(pub),'],
  ['crypto.subtle.verify("Ed25519",key,signature,','crypto.subtle.verify("Ed25519",key,qaCryptoBuffer(signature),']
 ]);
 transform("mesh-device-presence-qa/heartbeat.ts",[
  ['crypto.subtle.verify("Ed25519",verifyKey,signature,heartbeatMessage(uid,proof))',
   'crypto.subtle.verify("Ed25519",verifyKey,signature,qaCryptoBuffer(heartbeatMessage(uid,proof)))']
 ]);
 const deno=spawnSync("deno",["check","--no-config","--no-remote",
  "mesh-device-enrollment-entitled-qa/index.ts",
  "mesh-device-presence-qa-entitled-qa/index.ts",
  "mesh-inbox-send-entitled-qa/index.ts",
  "mesh-inbox-receive-entitled-qa/index.ts",
  "mesh-pairing-relay-entitled-qa/index.ts"],{
   cwd:shadow,encoding:"utf8",timeout:40000,maxBuffer:1000000
 });
 assert.equal(deno.status,0,"shadow Deno check failed: "+deno.stdout+" "+deno.stderr);
 console.log("KATOSYNC_DENO_TS6_SHADOW_FIVE_ENTRYPOINT_TYPECHECK_PASS");
 // Real signed vector verified by ORIGINAL and TS6 QA shadow — not a mock
 // of WebCrypto nor a changed Ed25519 payload.
 const sourceRelay=await import(pathToFileURL(join(src,"mesh-pairing-relay/protocol.ts")).href);
 const shadowRelay=await import(pathToFileURL(join(shadow,"mesh-pairing-relay/protocol.ts")).href);
 const sourceInbox=await import(pathToFileURL(join(src,"mesh-inbox-send/send.ts")).href);
 const shadowInbox=await import(pathToFileURL(join(shadow,"mesh-inbox-send/send.ts")).href);
 const owner="11111111-1111-4111-8111-111111111111";
 const origin="https://xbnnlyyxiilklsygxcof.supabase.co";
 const qaOrigin="https://abcdefghijklmnopqrst.supabase.co";
 const key=generateKeyPairSync("ed25519");
 const publicKey=key.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("base64url");
 const signature=(message)=>sign(null,Buffer.from(message),key.privateKey).toString("base64url");
 const expiresAt=Math.floor(Date.now()/1000)+61;
 const nonce=Buffer.alloc(32,7).toString("base64url");
 const proof={protocol:"katosync-mesh-pairing-relay-list-v2",
  deviceId:"22222222-2222-4222-8222-222222222222",origin,
  nonce,expiresAt,signature:""};
 proof.signature=signature([proof.protocol,owner,origin,proof.deviceId,nonce,String(expiresAt)].join("|"));
 const relayCases=[
  [proof,owner,origin,true],
  [{...proof,signature:Buffer.alloc(64,0).toString("base64url")},owner,origin,false],
  [{...proof,nonce:Buffer.alloc(32,8).toString("base64url")},owner,origin,false],
  [proof,"33333333-3333-4333-8333-333333333333",origin,false],
  [proof,owner,qaOrigin,false],
  [{...proof,expiresAt:Math.floor(Date.now()/1000)-10},owner,origin,false]
 ];
 for(const [p,uid,url,expected] of relayCases){
  const a=await sourceRelay.verifyRelayListProof(p,uid,publicKey,Date.now(),url);
  const b=await shadowRelay.verifyRelayListProof(p,uid,publicKey,Date.now(),url);
  assert.equal(a,b,"relay shadow parity");
  assert.equal(a,expected,"relay ground truth");
 }
 console.log("KATOSYNC_DENO_TS6_SHADOW_RELAY_REAL_ED25519_PARITY_PASS");
 const accountScope=createHash("sha256").update(
  "katosync-mesh-v1-account-scope:"+origin+":"+owner).digest("base64url");
 const offer={
  protocol:"katosync-mesh-pairing-v1",publicKey,nonce,expiresAt,
  accountScope,signature:signature(["katosync-mesh-pairing-v1",accountScope,
    publicKey,nonce,String(expiresAt)].join("|"))
 };
 const invite={protocol:"katosync-mesh-inbox-send-v1",
  sourceDeviceId:"22222222-2222-4222-8222-222222222222",
  targetDeviceId:"33333333-3333-4333-8333-333333333333",
  signedOffer:offer,dispatchSignature:""};
 invite.dispatchSignature=signature([invite.protocol,accountScope,
  invite.sourceDeviceId,invite.targetDeviceId,nonce,String(expiresAt)].join("|"));
 const inboxCases=[
  [invite,owner,true],
  [{...invite,dispatchSignature:Buffer.alloc(64).toString("base64url")},owner,false],
  [{...invite,targetDeviceId:"44444444-4444-4444-8444-444444444444"},owner,false],
  [invite,"55555555-5555-4555-8555-555555555555",false],
  [{...invite,signedOffer:{...offer,nonce:Buffer.alloc(32,3).toString("base64url")}},owner,false]
 ];
 for(const [v,uid,expected] of inboxCases){
  const a=await sourceInbox.verifyStoredSignedMeshInvite(v,uid);
  const b=await shadowInbox.verifyStoredSignedMeshInvite(v,uid);
  assert.equal(a,b,"inbox shadow parity");
  assert.equal(a,expected,"inbox ground truth");
 }
 console.log("KATOSYNC_DENO_TS6_SHADOW_INBOX_REAL_ED25519_PARITY_PASS");
 const sourceAgain=createHash("sha256").update(readFileSync(join(src,"mesh-inbox-send/send.ts"))).digest("hex");
 assert.equal(sourceAgain,hashes["mesh-inbox-send/send.ts"]);
 console.log("KATOSYNC_DENO_TS6_ORIGINAL_PINNED_BYTES_UNTOUCHED_PASS");
}finally{rmSync(tmp,{recursive:true,force:true});}
