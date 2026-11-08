#!/usr/bin/env node
// NMKato Solutions / KatoSync Stage 2U: physical two-Mac cryptographic QA.
// Only freshly generated synthetic Ed25519 keys + one-off TLS certificate.
// This script DOES NOT connect to Supabase, Keychain, Rust Mesh or Remote Jobs.
import tls from "node:tls";
import {readFileSync} from "node:fs";
import {createHash,generateKeyPairSync,createPublicKey,sign,verify,randomBytes,
 randomUUID,X509Certificate} from "node:crypto";

const vars=process.env;
const ROLE=vars.KATOSYNC_MESH_LAN_QA_ROLE??"";
const OWN=vars.KATOSYNC_MESH_LAN_QA_ADDRESS??"";
const PEER=vars.KATOSYNC_MESH_LAN_QA_EXPECT_PEER??"";
const ALLOW=vars.KATOSYNC_MESH_LAN_QA_ALLOW??"";
const PORT=Number(vars.KATOSYNC_MESH_LAN_QA_PORT);
const OWNER="11111111-1111-4111-8111-111111111111";
const SOURCE="22222222-2222-4222-8222-222222222222";
const TARGET="33333333-3333-4333-8333-333333333333";
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const OFFER="katosync-mesh-pairing-v1";
const SEND="katosync-mesh-inbox-send-v1";
const RECEIVE="katosync-mesh-inbox-recipient-v1";
const MAX=2500;
const b64=b=>Buffer.from(b).toString("base64url");
const scope=b64(createHash("sha256").update("katosync-mesh-v1-account-scope:"+ORIGIN+":"+OWNER).digest());
const validIp=x=>/^192\.168\.178\.(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(x);
function die(code){
 console.error("MESH_TWO_HOST_BLOCKED:"+code);
 process.exitCode=2;
}
if(ALLOW!=="SYNTHETIC_FIXTURES_ONLY"||!["server","client","client-wrong-pin"].includes(ROLE)||
  !validIp(OWN)||!validIp(PEER)||OWN===PEER||PORT!==49331){
 die("SYNTHETIC_LAN_OPT_IN_AND_EXACT_LOCAL_ADDRESSES_REQUIRED");
}else{
 await run();
}
function publicRaw(key){return key.export({format:"der",type:"spki"}).subarray(-32);}
function signText(privateKey,message){return b64(sign(null,Buffer.from(message),privateKey));}
function validSig(keyB64,signature,message){
 try{
  const raw=Buffer.from(keyB64,"base64url"),sig=Buffer.from(signature,"base64url");
  if(raw.length!==32||sig.length!==64||b64(raw)!==keyB64||b64(sig)!==signature)return false;
  const prefix=Buffer.from("302a300506032b6570032100","hex");
  const key=createPublicKey({key:Buffer.concat([prefix,raw]),format:"der",type:"spki"});
  return verify(null,Buffer.from(message),key,sig);
 }catch{return false;}
}
function readLines(socket,fn){
 let buffer="";
 socket.on("data",chunk=>{
  buffer+=chunk.toString("utf8");
  if(buffer.length>MAX){socket.destroy(Error("OVERSIZE"));return;}
  while(buffer.includes("\n")){
   const pos=buffer.indexOf("\n"),line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);
   try{fn(JSON.parse(line));}catch(err){console.error("MESH_TWO_HOST_INVALID_FRAME",String(err));socket.destroy();}
  }
 });
}
function sendJson(socket,obj){socket.write(JSON.stringify(obj)+"\n");}
function trustNever(obj){
 return obj?.paired===false&&obj?.transportReady===false&&obj?.remoteJobsEnabled===false;
}
async function run(){
 const isServer=ROLE==="server";
 if(isServer){
  const certPath=vars.KATOSYNC_MESH_LAN_QA_CERT??"";
  const keyPath=vars.KATOSYNC_MESH_LAN_QA_KEY??"";
  if(!certPath.startsWith("/tmp/ksmesh2u.")||!keyPath.startsWith("/tmp/ksmesh2u.")){
   die("ONLY_DISPOSABLE_CERT_PATHS");return;
  }
  const cert=readFileSync(certPath),key=readFileSync(keyPath);
  const fingerprint=createHash("sha256").update(new X509Certificate(cert).raw).digest("hex");
  const signing=generateKeyPairSync("ed25519"),senderPublic=b64(publicRaw(signing.publicKey));
  const server=tls.createServer({cert,key,minVersion:"TLSv1.3",maxVersion:"TLSv1.3",
    requestCert:false},socket=>{
    const addr=socket.remoteAddress?.replace("::ffff:","");
    if(addr!==PEER){console.error("MESH_TWO_HOST_UNKNOWN_PEER");socket.destroy();return;}
    const nonce=b64(randomBytes(32)),expiresAt=Math.floor(Date.now()/1000)+240;
    const requestId=randomUUID();
    const signedOffer={protocol:OFFER,publicKey:senderPublic,nonce,expiresAt,accountScope:scope,
      signature:signText(signing.privateKey,[OFFER,scope,senderPublic,nonce,String(expiresAt)].join("|"))};
    const dispatchSignature=signText(signing.privateKey,
      [SEND,scope,SOURCE,TARGET,nonce,String(expiresAt)].join("|"));
    sendJson(socket,{kind:"signed-invite",protocol:SEND,
      owner:OWNER,sourceDeviceId:SOURCE,targetDeviceId:TARGET,requestId,
      signedOffer,dispatchSignature,paired:false,transportReady:false,remoteJobsEnabled:false});
    readLines(socket,obj=>{
      const proof=obj?.proof,recipientPublic=obj?.recipientPublicKey;
      if(obj?.kind!=="signed-recipient-ack"||typeof recipientPublic!=="string"||
       !proof||proof.protocol!==RECEIVE||proof.deviceId!==TARGET||
       proof.action!=="accept"||proof.requestId!==requestId||
       proof.expiresAt*1000<=Date.now()||proof.expiresAt*1000>Date.now()+90000||
       !validSig(recipientPublic,proof.signature,
        [RECEIVE,OWNER,TARGET,"accept",requestId,proof.nonce,String(proof.expiresAt)].join("|"))
       ||Buffer.from(proof.nonce??"","base64url").length!==32||!trustNever(obj)){
       console.error("MESH_TWO_HOST_BAD_DEVICE_SIGNATURE");socket.destroy();return;
      }
      sendJson(socket,{kind:"qa-verified",requestId,
        paired:false,transportReady:false,remoteJobsEnabled:false});
      console.log("MESH_TWO_HOST_SYNTHETIC_ED25519_ACK_VERIFIED");
      socket.end();
      server.close();
    });
  });
  server.on("error",error=>{console.error("MESH_TWO_HOST_LISTEN_FAILED",String(error));process.exitCode=1;});
  server.listen(PORT,OWN,()=>console.log("MESH_TWO_HOST_QA_SERVER_READY pin_sha256="+fingerprint));
  setTimeout(()=>{if(server.listening){server.close();process.exitCode=3;
    console.error("MESH_TWO_HOST_TIMEOUT");}},35000).unref();
 }else{
  const pin=(vars.KATOSYNC_MESH_LAN_QA_CERT_PIN??"").toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(pin)){die("CERTIFICATE_PIN_REQUIRED");return;}
  const negative=ROLE==="client-wrong-pin";
  if(negative&&vars.KATOSYNC_MESH_LAN_QA_WRONG_PIN!=="YES"){
   die("WRONG_PIN_EXPLICIT_OPT_IN_REQUIRED");return;
  }
  const expect=negative?("0"===pin[0]?"1":"0")+pin.slice(1):pin;
  const recipient=generateKeyPairSync("ed25519");
  const recipientPublic=b64(publicRaw(recipient.publicKey));
  const socket=tls.connect({host:PEER,port:PORT,minVersion:"TLSv1.3",maxVersion:"TLSv1.3",
    rejectUnauthorized:false,serverName:"synthetic-mesh.invalid"});
  socket.setTimeout(12000,()=>socket.destroy(Error("QA_TIMEOUT")));
  let verifiedPin=false,finished=false;
  socket.once("secureConnect",()=>{
   const raw=socket.getPeerCertificate(true).raw;
   const actual=createHash("sha256").update(raw).digest("hex");
   if(actual!==expect){
    if(negative){console.log("MESH_TWO_HOST_WRONG_CERT_PIN_REJECTED");finished=true;}
    else {console.error("MESH_TWO_HOST_CERT_PIN_MISMATCH");process.exitCode=4;}
    socket.destroy();return;
   }
   if(negative){console.error("MESH_TWO_HOST_WRONG_PIN_INCORRECTLY_ACCEPTED");
      process.exitCode=5;socket.destroy();return;}
   verifiedPin=true;
  });
  readLines(socket,obj=>{
   if(!verifiedPin||!trustNever(obj))throw Error("QA_NOT_PINNED_OR_TRUST_RESPONSE");
   if(obj?.kind==="signed-invite"){
    const offer=obj.signedOffer;
    if(obj.protocol!==SEND||obj.owner!==OWNER||obj.sourceDeviceId!==SOURCE||
       obj.targetDeviceId!==TARGET||offer?.protocol!==OFFER||
       offer.accountScope!==scope||offer.expiresAt*1000<=Date.now()||
       !validSig(offer.publicKey,offer.signature,
        [OFFER,scope,offer.publicKey,offer.nonce,String(offer.expiresAt)].join("|"))||
       !validSig(offer.publicKey,obj.dispatchSignature,
        [SEND,scope,SOURCE,TARGET,offer.nonce,String(offer.expiresAt)].join("|")))throw Error("QA_BAD_SENDER_SIGNATURE");
    const nonce=b64(randomBytes(32)),expiresAt=Math.floor(Date.now()/1000)+65;
    const proof={protocol:RECEIVE,deviceId:TARGET,action:"accept",
      requestId:obj.requestId,nonce,expiresAt,
      signature:signText(recipient.privateKey,
        [RECEIVE,OWNER,TARGET,"accept",obj.requestId,nonce,String(expiresAt)].join("|"))};
    sendJson(socket,{kind:"signed-recipient-ack",recipientPublicKey:recipientPublic,proof,
      paired:false,transportReady:false,remoteJobsEnabled:false});
    console.log("MESH_TWO_HOST_QA_SIGNED_INVITE_RECEIVED");
   }else if(obj?.kind==="qa-verified"){
    console.log("MESH_TWO_HOST_QA_RECEIPT_VERIFIED");
    finished=true;socket.end();
   }else throw Error("QA_UNKNOWN_FRAME");
  });
  socket.on("error",err=>{if(!finished){console.error("MESH_TWO_HOST_SOCKET_FAILED",String(err));process.exitCode=7;}});
  socket.on("close",()=>{if(!finished){console.error("MESH_TWO_HOST_UNFINISHED");process.exitCode=8;}});
 }
}
