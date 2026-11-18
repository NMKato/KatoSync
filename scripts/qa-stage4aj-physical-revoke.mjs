// KatoSync Stage4AJ — isolated two-Mac QA, NOT a production MCP/device route.
// TLS 1.3 mutual certificate auth + separate Ed25519 signed revoke & device ACK.
// All keys, markers and metadata are restricted to disposable /tmp fixtures.
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

export const DOMAIN_NOTICE = "KatoSync-Stage4AJ-QA-SIGNED-REVOKE-v1\n";
export const DOMAIN_ACK = "KatoSync-Stage4AJ-QA-DEVICE-RECEIPT-v1\n";
export const SCOPE = ["auditId","ownerId","tenantId","grantId","consentId",
  "clientId","ownerSessionId","projectId","taskId","localDeviceKey",
  "peerDeviceKey","recipientDeviceId","sequence","rc66kAckSha256"];
const sha = text => crypto.createHash("sha256").update(text).digest("hex");
const deny = reason => {throw Error("STAGE4AJ_DENY_" + reason);};
const read = (dir,name) => fs.readFileSync(path.join(dir,name),"utf8");
const safeRoot = arg => {
  const p=fs.realpathSync(arg);
  if (!p.startsWith("/private/tmp/katosync-stage4aj-") &&
      !p.startsWith("/tmp/katosync-stage4aj-")) deny("FIXTURE_ONLY");
  const s=fs.statSync(p);
  if ((s.mode & 0o077)!==0) deny("FIXTURE_PERMISSIONS");
  return p;
};
export function bodyFor(manifest, now=Date.now()) {
  const scope={};
  for(const field of SCOPE) scope[field]=manifest[field];
  return {...scope,kind:"STAGE4AJ_QA_DEVICE_REVOKE",version:1,
    issuedAtMs:now,expiresAtMs:now+30_000};
}
export function signingBytes(domain, text) {return Buffer.from(domain+text,"utf8");}
export function makeSigned(domain, payload, pem) {
  const payloadText=JSON.stringify(payload);
  return {payloadText,signature:crypto.sign(null,signingBytes(domain,payloadText),pem).toString("base64url")};
}
export function verifySigned(domain, frame, pinnedPub) {
  if(!frame || typeof frame.payloadText!=="string" ||
     frame.payloadText.length>4096 || typeof frame.signature!=="string" ||
     frame.signature.length>200) deny("MALFORMED_FRAME");
  const bytes=Buffer.from(frame.signature,"base64url");
  if(bytes.length!==64 ||
     !crypto.verify(null,signingBytes(domain,frame.payloadText),pinnedPub,bytes))
       deny("BAD_SIGNATURE");
  let data;
  try {data=JSON.parse(frame.payloadText);}catch{deny("BAD_JSON");}
  if(!data || Array.isArray(data) || typeof data!=="object" ||
     JSON.stringify(data)!==frame.payloadText) deny("NOT_CANONICAL");
  return data;
}
export function verifyRevoke(frame, manifest, issuerPub, now=Date.now()) {
  const b=verifySigned(DOMAIN_NOTICE,frame,issuerPub);
  const expected=[...SCOPE,"kind","version","issuedAtMs","expiresAtMs"];
  if(Object.keys(b).length!==expected.length ||
     expected.some(k=>!Object.hasOwn(b,k))) deny("FIELDS");
  if(b.kind!=="STAGE4AJ_QA_DEVICE_REVOKE" || b.version!==1) deny("KIND");
  for(const field of SCOPE){
    if(b[field]!==manifest[field]) deny("SCOPE_"+field);
  }
  if(!Number.isSafeInteger(b.sequence) || b.sequence<1 ||
     !/^[a-f0-9]{64}$/.test(b.rc66kAckSha256) ||
     !Number.isSafeInteger(b.issuedAtMs) ||
     !Number.isSafeInteger(b.expiresAtMs) ||
     b.issuedAtMs>now+2000 || b.issuedAtMs<now-10_000 ||
     b.expiresAtMs<=now || b.expiresAtMs-b.issuedAtMs!==30_000)
       deny("CLOCK_OR_SEQUENCE");
  return b;
}
export function persistRevocation(dir, notice) {
  const filename=path.join(dir,"revoked.lock");
  // No missing marker can ever mean execution authority; this routine only
  // stores an irreversible QA revoke. Never delete a marker to re-arm.
  const contents="KatoSync-Stage4AJ-QA-REVOCATION-v1\n"+
    notice.sequence+"\n"+sha(JSON.stringify(notice))+"\n";
  let fd;
  try{
    fd=fs.openSync(filename,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW||0),0o600);
  }catch(e){
    if(e.code==="EEXIST") return "replay_denied";
    deny("STORAGE_CREATE");
  }
  try{
    fs.writeFileSync(fd,contents);
    fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  try{
    const d=fs.openSync(dir,"r");try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  }catch{deny("DIR_SYNC");}
  return "revoked_persisted";
}
export function verifyDeviceReceipt(frame, manifest, devicePub, noticeDigest, expectedStatus) {
  const ack=verifySigned(DOMAIN_ACK,frame,devicePub);
  if(Object.keys(ack).length!==8 ||
     ack.kind!=="STAGE4AJ_QA_DEVICE_ACK" || ack.version!==1 ||
     ack.status!==expectedStatus || ack.auditId!==manifest.auditId ||
     ack.taskId!==manifest.taskId || ack.sequence!==manifest.sequence ||
     ack.recipientDeviceId!==manifest.recipientDeviceId ||
     ack.noticeSha256!==noticeDigest) deny("ACK_BINDING");
  return ack;
}
function peerGuard(socket,expectedCn) {
  if(!socket.authorized || socket.getProtocol()!=="TLSv1.3")
    deny("UNAUTHENTICATED_TLS");
  const peer=socket.getPeerCertificate();
  if(peer?.subject?.CN!==expectedCn) deny("WRONG_TLS_PEER");
}
function framed(socket,onMessage){
  let buffer="";
  socket.setTimeout(25000,()=>socket.destroy(Error("STAGE4AJ_TIMEOUT")));
  socket.on("data",chunk=>{
    buffer+=chunk.toString("utf8");
    if(Buffer.byteLength(buffer)>10_000){socket.destroy(Error("STAGE4AJ_OVERSIZE"));return;}
    while(buffer.includes("\n")){
      const index=buffer.indexOf("\n");
      const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
      try{onMessage(JSON.parse(line));}catch(e){socket.destroy(e);}
    }
  });
}
function send(socket,object){socket.write(JSON.stringify(object)+"\n");}
function serve(dir,manifest){
  const opts={key:read(dir,"server.key"),cert:read(dir,"server.crt"),
    ca:read(dir,"ca.crt"),requestCert:true,rejectUnauthorized:true,
    minVersion:"TLSv1.3",maxVersion:"TLSv1.3"};
  const issuer=read(dir,"issuer-private.pem");
  const devicePub=read(dir,"device-public.pem");
  let connections=0;
  const server=tls.createServer(opts,socket=>{
    try{
      if(++connections!==1) deny("MULTIPLE_CONNECTIONS");
      peerGuard(socket,"KatoSync-Stage4AJ-QA-M3");
      const signed=makeSigned(DOMAIN_NOTICE,bodyFor(manifest),issuer);
      const payload=JSON.parse(signed.payloadText);
      const digest=sha(signed.payloadText);
      let phase=0;
      framed(socket,msg=>{
        if(msg.type!=="ack") deny("UNEXPECTED_MESSAGE");
        const desired=phase===0?"revoked_persisted":"replay_denied";
        verifyDeviceReceipt(msg,manifest,devicePub,digest,desired);
        if(phase===0){phase=1;send(socket,{type:"revoke",...signed});}
        else{
          console.log("STAGE4AJ_REAL_TWO_MAC_MTLS_SIGNED_REVOKE_REPLAY_PASS_NO_REMOTE");
          socket.end();server.close();
        }
      });
      send(socket,{type:"revoke",...signed});
      if(payload.sequence!==manifest.sequence) deny("SERVER_SEQUENCE");
    }catch(e){console.error(e.message);socket.destroy();server.close();}
  });
  server.on("error",e=>{console.error("STAGE4AJ_SERVER_ERROR "+e.message);process.exitCode=1;});
  server.listen(0,"0.0.0.0",()=>{
    console.log("STAGE4AJ_TLS13_SERVER_READY PORT="+server.address().port);
  });
}
function receive(dir,manifest,host,port){
  const opts={host,port:Number(port),servername:"Mac.fritz.box",
    key:read(dir,"client.key"),cert:read(dir,"client.crt"),
    ca:read(dir,"ca.crt"),rejectUnauthorized:true,
    minVersion:"TLSv1.3",maxVersion:"TLSv1.3"};
  const issuerPub=read(dir,"issuer-public.pem");
  const devicePriv=read(dir,"device-private.pem");
  const socket=tls.connect(opts,()=>{
    try{peerGuard(socket,"KatoSync-Stage4AJ-QA-M2");}
    catch(e){socket.destroy(e);}
  });
  let count=0;
  framed(socket,msg=>{
    if(msg.type!=="revoke" || ++count>2) deny("UNEXPECTED_MESSAGE");
    const notice=verifyRevoke(msg,manifest,issuerPub);
    const status=persistRevocation(dir,notice);
    if(count===1 && status!=="revoked_persisted") deny("FIRST_NOT_NEW");
    if(count===2 && status!=="replay_denied") deny("REPLAY_ACCEPTED");
    const receipt={kind:"STAGE4AJ_QA_DEVICE_ACK",version:1,
      status,auditId:notice.auditId,taskId:notice.taskId,
      sequence:notice.sequence,recipientDeviceId:notice.recipientDeviceId,
      noticeSha256:sha(msg.payloadText)};
    send(socket,{type:"ack",...makeSigned(DOMAIN_ACK,receipt,devicePriv)});
    if(count===2) console.log("STAGE4AJ_M3_DEVICE_REVOKED_DURABLE_REPLAY_DENIED_PASS");
  });
  socket.on("error",e=>{console.error("STAGE4AJ_CLIENT_ERROR "+e.message);process.exitCode=1;});
}
if(process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href===import.meta.url){
  try{
    const [role,folder,host,port]=process.argv.slice(2);
    const dir=safeRoot(folder);
    const manifest=JSON.parse(read(dir,"manifest.json"));
    if(!SCOPE.every(key=>Object.hasOwn(manifest,key))) deny("INCOMPLETE_MANIFEST");
    if(role==="server") serve(dir,manifest);
    else if(role==="client") receive(dir,manifest,host,port);
    else deny("BAD_ROLE");
  }catch(e){console.error(e.message);process.exitCode=1;}
}
