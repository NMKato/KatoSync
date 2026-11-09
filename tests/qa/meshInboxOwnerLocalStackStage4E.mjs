// KatoSync Stage4E — isolated authentic ES256 test auth + real PG17 RPC.
// Synthetic identities only. NO Supabase cloud access, NO deployment.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {generateKeyPairSync,sign,verify,randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {realpathSync,statSync} from "node:fs";
import {handleInboxTerminalOwnerQA} from "../../supabase/functions/mesh-inbox-terminal-owner-qa/handler.ts";

const OWNER="22222222-2222-4222-8222-222222222222";
const FOREIGN="11111111-1111-4111-8111-111111111111";
const ORIGIN="https://abcdefghijklmnopqrst.supabase.co";
const ANON="sb_publishable_"+"a".repeat(44),SECRET="sb_secret_"+"s".repeat(44);
const env={SUPABASE_URL:ORIGIN,SUPABASE_ANON_KEY:ANON,
 SUPABASE_SERVICE_ROLE_KEY:SECRET,
 KATOSYNC_INBOX_TERMINAL_OWNER_STAGE:"qa-cancel-only",
 KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF:"abcdefghijklmnopqrst"};
const path=process.env.KATOSYNC_MESH_E2E_SOCKET??"";
const port=process.env.KATOSYNC_MESH_E2E_PORT??"";
if(process.env.KATOSYNC_INBOX_LOCAL_STACK_QA_ONLY!=="EPHEMERAL_LOOPBACK_PG17"||
 !/^\/tmp\/ksmeshqa\.[A-Za-z0-9]{6}$/.test(path)||port!=="55439")
 throw Error("KATOSYNC_LOCAL_STACK_REQUIRES_DISPOSABLE_UNIX_SOCKET");
const real=realpathSync(path);
assert.ok(real===path||real==="/private"+path);
assert.equal(statSync(real).mode&0o777,0o700);
const pg=(process.env.KATOSYNC_PG_BIN??"/opt/homebrew/opt/postgresql@17/bin")+"/psql";
const args=["-h",path,"-p",port,"-U","postgres","-d","postgres","-X","-Atq","-v","ON_ERROR_STOP=1"];
const uuid=s=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
function sql(s){return execFileSync(pg,[...args,"-c",s],{
 encoding:"utf8",timeout:6000,maxBuffer:65536}).trim();}
function u(s){assert.ok(uuid(s));return "'"+s+"'::uuid";}
function state(id){return sql("SELECT state FROM katosync.mesh_invites WHERE request_id="+u(id));}
function audits(id){return Number(sql("SELECT count(*) FROM katosync.mesh_inbox_lifecycle_audit_qa WHERE request_id="+u(id)));}
const {privateKey,publicKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const sessions=new Set();
const b64=s=>Buffer.from(JSON.stringify(s)).toString("base64url");
function issue(id,expired=false){
 const sid=randomUUID(),now=Math.floor(Date.now()/1000);sessions.add(sid);
 const data=b64({alg:"ES256",typ:"JWT"})+"."+
  b64({iss:"KatoSync-local-QA",role:"authenticated",sub:id,
   session_id:sid,iat:now-2,exp:now+(expired?-5:180)});
 const sig=sign("sha256",Buffer.from(data),
  {key:privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url");
 return {jwt:data+"."+sig,sid};
}
function auth(jwt){
 try{
  const parts=jwt.split(".");if(parts.length!==3)return null;
  const h=JSON.parse(Buffer.from(parts[0],"base64url").toString());
  const p=JSON.parse(Buffer.from(parts[1],"base64url").toString());
  if(h.alg!=="ES256"||h.typ!=="JWT"||p.iss!=="KatoSync-local-QA"||
     p.role!=="authenticated"||!uuid(p.sub)||!uuid(p.session_id)||
     !sessions.has(p.session_id)||p.exp<=Math.floor(Date.now()/1000)||
     p.iat>Math.floor(Date.now()/1000)+5)return null;
  return verify("sha256",Buffer.from(parts[0]+"."+parts[1]),
   {key:publicKey,dsaEncoding:"ieee-p1363"},
   Buffer.from(parts[2],"base64url"))?p:null;
 }catch{return null;}
}
let authCalls=0,memberCalls=0,rpcCalls=0;
function reply(res,status,body){
 res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});
 res.end(JSON.stringify(body));
}
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url??"/","http://127.0.0.1");
  if(req.method==="GET"&&url.pathname==="/auth/v1/user"){
   authCalls++;
   const bearer=req.headers.authorization??"";
   const user=req.headers.apikey===ANON&&bearer.startsWith("Bearer ")?
    auth(bearer.slice(7)):null;
   return user?reply(res,200,{id:user.sub,role:"authenticated",is_anonymous:false}):
    reply(res,401,{error:"invalid-local-session"});
  }
  if(req.headers.apikey!==SECRET||req.headers.authorization)
   return reply(res,403,{error:"service-key-required"});
  if(req.method==="GET"&&url.pathname==="/rest/v1/account_memberships"){
   memberCalls++;
   const filter=url.searchParams.get("user_id")??"";
   const owner=filter.startsWith("eq.")?filter.slice(3):null;
   if(!uuid(owner)||req.headers["accept-profile"]!=="katosync"||
      url.searchParams.get("limit")!=="2")
    return reply(res,400,{error:"bad-membership-query"});
   const rows=sql(`SELECT COALESCE(json_agg(row_to_json(t)),'[]'::json)
     FROM (SELECT user_id,access_state,authorized_at,revoked_at
       FROM katosync.account_memberships WHERE user_id=${u(owner)} LIMIT 2) t`);
   return reply(res,200,JSON.parse(rows));
  }
  if(req.method==="POST"&&url.pathname==="/rest/v1/rpc/mesh_inbox_terminal_close_qa"){
   rpcCalls++;
   if(req.headers["content-profile"]!=="katosync")
    return reply(res,403,{error:"missing-qa-schema"});
   let body="";for await(const part of req){
    body+=part.toString();if(body.length>512)return reply(res,413,{error:"too-large"});
   }
   const q=JSON.parse(body);
   if(Object.keys(q).length!==3||!uuid(q.p_owner)||!uuid(q.p_request)||
       q.p_terminal!=="cancelled")return reply(res,400,{error:"invalid-rpc"});
   const result=sql(`SET ROLE service_role;
    SELECT katosync.mesh_inbox_terminal_close_qa(
      ${u(q.p_owner)},${u(q.p_request)},'cancelled');`);
   return reply(res,200,result);
  }
  return reply(res,404,{error:"unknown-local-route"});
 }catch{return reply(res,503,{error:"local-test-only-failure"});}
});
await new Promise((ok,fail)=>{
 server.once("error",fail);
 server.listen(0,"127.0.0.1",ok);
});
const addr=server.address();
assert.ok(addr&&typeof addr!=="string"&&addr.address==="127.0.0.1");
const fetcher=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 assert.equal(url.origin,ORIGIN,"request tried to reach a different Supabase project");
 assert.ok(["/auth/v1/user","/rest/v1/account_memberships",
  "/rest/v1/rpc/mesh_inbox_terminal_close_qa"].includes(url.pathname));
 assert.equal(init?.redirect,"error");
 return fetch("http://127.0.0.1:"+addr.port+url.pathname+url.search,
  {...init,redirect:"error"});
};
async function cancel(jwt,id){
 return handleInboxTerminalOwnerQA(new Request("https://local.qa/owner",{
  method:"POST",headers:{authorization:"Bearer "+jwt,
   "Content-Type":"application/json"},
  body:JSON.stringify({action:"cancel",requestId:id})
 }),env,{fetcher});
}
const pending=sql("SELECT request_id FROM katosync.mesh_invites WHERE owner_user_id="+
 u(OWNER)+" AND nonce=repeat('R',43) AND state='pending'");
assert.ok(uuid(pending));
try{
 const owner=issue(OWNER),other=issue(FOREIGN);
 const tampered=owner.jwt.slice(0,-2)+"AA";
 assert.equal((await cancel(tampered,pending)).status,401);
 assert.equal((await cancel(issue(OWNER,true).jwt,pending)).status,401);
 const revoked=issue(OWNER);sessions.delete(revoked.sid);
 assert.equal((await cancel(revoked.jwt,pending)).status,401);
 assert.equal(rpcCalls,0);
 console.log("LOCALSTACK_ES256_INVALID_EXPIRED_SIGNED_OUT_DENIED");
 assert.equal((await cancel(other.jwt,pending)).status,403);
 assert.equal(rpcCalls,0);
 console.log("LOCALSTACK_REVOKED_MEMBERSHIP_DENIED");
 sql("UPDATE katosync.account_memberships SET access_state='active',"+
  "revoked_at=NULL,authorized_at=clock_timestamp() WHERE user_id="+u(FOREIGN));
 assert.equal((await cancel(other.jwt,pending)).status,404);
 assert.equal(state(pending),"pending");assert.equal(audits(pending),0);
 console.log("LOCALSTACK_FOREIGN_AUTHENTICATED_OWNER_DENIED");
 // Restrictive cancellation is allowed even after Free0 downgrade.
 sql("DELETE FROM katosync.mesh_owner_policy WHERE owner_user_id="+u(OWNER));
 const closed=await cancel(owner.jwt,pending);
 assert.equal(closed.status,200);
 assert.deepEqual(await closed.json(),{requestId:pending,state:"cancelled",
  alreadyClosed:false,paired:false,transportReady:false,remoteJobsEnabled:false});
 assert.equal(state(pending),"cancelled");assert.equal(audits(pending),1);
 console.log("LOCALSTACK_REAL_POSTGRES_17_ATOMIC_CANCEL_FREE0");
 const repeated=await cancel(owner.jwt,pending);
 assert.equal(repeated.status,200);
 assert.equal((await repeated.json()).alreadyClosed,true);
 assert.equal(audits(pending),1);
 console.log("LOCALSTACK_IDEMPOTENT_ONE_AUDIT");
 const proof=sql("SELECT proof_id FROM katosync.mesh_inbox_proofs WHERE request_id="+u(pending));
 assert.ok(uuid(proof));
 const late=sql(`SET ROLE service_role;
  UPDATE katosync.mesh_invites SET state='accepted',resolved_at=clock_timestamp(),
   resolution_proof_id=${u(proof)}
   WHERE request_id=${u(pending)} AND state='pending' RETURNING request_id;`);
 assert.equal(late,"");assert.equal(state(pending),"cancelled");
 assert.equal(rpcCalls,3);assert.ok(authCalls>=7&&memberCalls>=7);
 console.log("LOCALSTACK_LATE_ACCEPT_DENIED_NO_REOPEN");
 console.log("KATOSYNC_STAGE4E_LOCALSTACK_AUTH_EDGE_SQL_PASS_NO_REMOTE");
}finally{
 await new Promise(ok=>server.close(ok));
}
