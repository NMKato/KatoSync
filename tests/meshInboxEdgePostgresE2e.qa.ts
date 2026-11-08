// NMKato Solutions. End-to-end signed Edge + ACTUAL isolated PostgreSQL 17 QA.
// Strictly offline synthetic M2/M3 identities. Never uses production credentials.
import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {submitSignedMeshInvite} from "../supabase/functions/mesh-inbox-send/send.ts";
import {handleMeshInboxReceive} from "../supabase/functions/mesh-inbox-receive/receive.ts";
const SOCK=process.env.KATOSYNC_MESH_E2E_SOCKET??"";
const PORT=process.env.KATOSYNC_MESH_E2E_PORT??"";
if(!/^\/tmp\/ksmeshqa\.[A-Za-z0-9]{6}$/.test(SOCK)||PORT!=="55439"||
 process.env.KATOSYNC_MESH_E2E_ALLOW!=="EPHEMERAL_UNIX_SOCKET_ONLY")
 throw Error("MESH_E2E_BLOCKED: explicitly approved disposable Unix socket required");
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const OWNER="11111111-1111-4111-8111-111111111111";
const SOURCE="22222222-2222-4222-8222-222222222222";
const TARGET="33333333-3333-4333-8333-333333333333";
const EMPTY="00000000-0000-4000-8000-000000000000";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enc=new TextEncoder();
const b64=(v:Uint8Array)=>Buffer.from(v).toString("base64url");
const jsonSql=(v:unknown)=>"convert_from(decode('"+Buffer.from(JSON.stringify(v)).toString("base64")+"','base64'),'UTF8')::jsonb";
const env={SUPABASE_URL:ORIGIN,SUPABASE_ANON_KEY:"qa-public-not-real",
 SUPABASE_SERVICE_ROLE_KEY:"qa-secret-not-real",KATOSYNC_MESH_INBOX_STAGE:"send-only",
 KATOSYNC_MESH_INBOX_RECEIVE_STAGE:"qa-inbox"};
function uuid(v:string){if(!UUID.test(v))throw Error("QA_BAD_UUID");return v;}
function pg(query:string,service=false):unknown{
 const p=spawnSync("/opt/homebrew/opt/postgresql@17/bin/psql",[
 "-X","-q","-t","-A","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose",
 "-h",SOCK,"-p",PORT,"-U","postgres","-d","postgres",
 "-c",(service?"SET ROLE service_role;\n":"")+query
 ],{encoding:"utf8",timeout:8000,env:{PATH:"/usr/bin:/bin",HOME:"/tmp",LANG:"C"}});
 if(p.error)throw p.error;
 if(p.status!==0)throw Error("LOCAL_PG_DENIED: "+p.stderr.slice(0,650));
 const out=p.stdout.trim();
 return out?JSON.parse(out):null;
}
function selectRows(table:string,where:string,columns:string,limit=10){
 const q="SELECT coalesce(json_agg(t),'[]'::json) FROM "+
  "(SELECT "+columns+" FROM katosync."+table+" WHERE "+where+" LIMIT "+limit+") t";
 const r=pg(q,true);
 if(!Array.isArray(r))throw Error("QA_POSTGRES_EXPECTED_ARRAY");
 return r;
}
function denied(err:unknown){
 const text=String(err),code=text.includes("23505")?"23505":text.includes("23514")?"23514":"08006";
 return Response.json({code,message:text.match(/KATOSYNC_MESH_[A-Z_]+/)?.[0]??"DATABASE_DENIED"},
 {status:code==="23505"?409:code==="23514"?400:503});
}
function backend(rotateAfterProof=false){
 const counts={writes:0,proofs:0,lists:0,patches:0,denied:0};
 const request=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.origin!==ORIGIN)throw Error("QA_NO_REMOTE_NETWORK");
  const method=init?.method??"GET";
  if(url.pathname==="/auth/v1/user")return Response.json({id:OWNER,is_anonymous:false});
  if(url.pathname==="/rest/v1/account_memberships")
   return Response.json([{user_id:OWNER,access_state:"active",
     authorized_at:"2026-10-28T12:00:00Z",revoked_at:null}]);
  assert.ok(url.pathname.startsWith("/rest/v1/"));
  const headers=init?.headers as Record<string,string>|undefined;
  assert.equal(headers?.[method==="GET"?"Accept-Profile":"Content-Profile"],"katosync");
  if(url.pathname==="/rest/v1/mesh_devices"&&method==="GET"){
   assert.equal(url.searchParams.get("owner_user_id"),"eq."+OWNER);
   const filter=url.searchParams.get("device_id")??"";
   let ids:string[];
   if(filter.startsWith("eq."))ids=[uuid(filter.slice(3))];
   else if(filter.startsWith("in.(")&&filter.endsWith(")"))
    ids=filter.slice(4,-1).split(",").map(uuid);
   else throw Error("QA_UNBOUNDED_ROSTER_QUERY");
   return Response.json(selectRows("mesh_devices",
    "owner_user_id='"+OWNER+"' AND device_id IN ("+ids.map(x=>"'"+x+"'").join(",")+")",
    "device_id,owner_user_id,signing_public_key,membership_state,revoked_at",ids.length+1));
  }
  if(url.pathname==="/rest/v1/mesh_invites"&&method==="POST"){
   counts.writes++;
   const body=JSON.parse(String(init?.body));
   assert.equal(body.owner_user_id,OWNER);assert.equal(body.source_device_id,SOURCE);
   assert.equal(body.target_device_id,TARGET);
   const query="WITH b AS (SELECT "+jsonSql(body)+" j), a AS ("+
    "INSERT INTO katosync.mesh_invites ("+
    "owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,state,expires_at) "+
    "SELECT (j->>'owner_user_id')::uuid,(j->>'source_device_id')::uuid,"+
    "(j->>'target_device_id')::uuid,j->>'nonce',j->'signed_offer',j->>'dispatch_signature',"+
    "j->>'state',(j->>'expires_at')::timestamptz FROM b RETURNING request_id) "+
    "SELECT coalesce(json_agg(a),'[]'::json) FROM a";
   try{return Response.json(pg(query,true),{status:201});}
   catch(err){return denied(err);}
  }
  if(url.pathname==="/rest/v1/mesh_inbox_proofs"&&method==="POST"){
   counts.proofs++;
   const body=JSON.parse(String(init?.body));
   assert.equal(body.owner_user_id,OWNER);assert.equal(body.device_id,TARGET);
   const query="WITH b AS (SELECT "+jsonSql(body)+" j), a AS ("+
    "INSERT INTO katosync.mesh_inbox_proofs ("+
    "owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at) "+
    "SELECT (j->>'owner_user_id')::uuid,(j->>'device_id')::uuid,"+
    "j->>'signing_public_key',j->>'nonce',j->>'action',"+
    "(j->>'request_id')::uuid,(j->>'expires_at')::timestamptz FROM b "+
    "RETURNING proof_id,owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at) "+
    "SELECT coalesce(json_agg(a),'[]'::json) FROM a";
   try{
    const saved=pg(query,true);
    if(rotateAfterProof)pg("UPDATE katosync.mesh_devices SET signing_public_key='"+
      b64(new Uint8Array(32).fill(86))+"' WHERE device_id='"+TARGET+"'");
    return Response.json(saved,{status:201});
   }catch(err){return denied(err);}
  }
  if(url.pathname==="/rest/v1/mesh_invites"&&method==="GET"){
   counts.lists++;
   assert.equal(url.searchParams.get("owner_user_id"),"eq."+OWNER);
   assert.equal(url.searchParams.get("target_device_id"),"eq."+TARGET);
   return Response.json(selectRows("mesh_invites",
    "owner_user_id='"+OWNER+"' AND target_device_id='"+TARGET+"'"+
    " AND state='pending' AND expires_at>now()",
    "request_id,owner_user_id,source_device_id,target_device_id,state,expires_at,signed_offer,dispatch_signature"));
  }
  if(url.pathname==="/rest/v1/mesh_invites"&&method==="PATCH"){
   counts.patches++;
   const f=url.searchParams.get("request_id")??"";
   if(!f.startsWith("eq."))throw Error("QA_UNBOUNDED_PATCH");
   const reqId=uuid(f.slice(3));
   assert.equal(url.searchParams.get("owner_user_id"),"eq."+OWNER);
   assert.equal(url.searchParams.get("target_device_id"),"eq."+TARGET);
   assert.equal(url.searchParams.get("state"),"eq.pending");
   const body=JSON.parse(String(init?.body));
   assert.ok(["accepted","rejected"].includes(body.state));
   const query="WITH b AS (SELECT "+jsonSql(body)+" j), a AS ("+
    "UPDATE katosync.mesh_invites i SET state=b.j->>'state',"+
    "resolved_at=(b.j->>'resolved_at')::timestamptz,"+
    "resolution_proof_id=(b.j->>'resolution_proof_id')::uuid FROM b WHERE "+
    "i.request_id='"+reqId+"' AND i.owner_user_id='"+OWNER+"'"+
    " AND i.target_device_id='"+TARGET+"' AND i.state='pending' AND i.expires_at>now() "+
    "RETURNING i.request_id,i.owner_user_id,i.target_device_id,i.state,i.resolved_at) "+
    "SELECT coalesce(json_agg(a),'[]'::json) FROM a";
   try{return Response.json(pg(query,true));}
   catch(err){counts.denied++;return denied(err);}
  }
  throw Error("QA_UNKNOWN_REST_ROUTE "+url.pathname);
 };
 return {request:request as typeof fetch,counts};
}
async function setup(){
 const sender=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const recipient=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const senderPublic=b64(new Uint8Array(await crypto.subtle.exportKey("raw",sender.publicKey)));
 const recipientPublic=b64(new Uint8Array(await crypto.subtle.exportKey("raw",recipient.publicKey)));
 const scope=b64(new Uint8Array(await crypto.subtle.digest("SHA-256",
  enc.encode("katosync-mesh-v1-account-scope:"+ORIGIN+":"+OWNER))));
 pg("INSERT INTO katosync.mesh_devices "+
  "(device_id,owner_user_id,signing_public_key,fingerprint,display_name,platform_os) VALUES "+
  "('"+SOURCE+"','"+OWNER+"','"+senderPublic+"','"+Array(16).fill("AA").join("-")+"','Synthetic Mac A','macos'),"+
  "('"+TARGET+"','"+OWNER+"','"+recipientPublic+"','"+Array(16).fill("BB").join("-")+"','Synthetic Mac B','macos')");
 async function offer(){
  const nonce=b64(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt=Math.floor(Date.now()/1000)+240;
  const payload=["katosync-mesh-pairing-v1",scope,senderPublic,nonce,String(expiresAt)].join("|");
  const signature=b64(new Uint8Array(await crypto.subtle.sign("Ed25519",sender.privateKey,enc.encode(payload))));
  const dispatch=["katosync-mesh-inbox-send-v1",scope,SOURCE,TARGET,nonce,String(expiresAt)].join("|");
  return {protocol:"katosync-mesh-inbox-send-v1",sourceDeviceId:SOURCE,targetDeviceId:TARGET,
   signedOffer:{protocol:"katosync-mesh-pairing-v1",publicKey:senderPublic,nonce,expiresAt,
   accountScope:scope,signature},
   dispatchSignature:b64(new Uint8Array(await crypto.subtle.sign("Ed25519",sender.privateKey,enc.encode(dispatch))))};
 }
 async function proof(action:"list"|"accept"|"reject",requestId=EMPTY){
  const nonce=b64(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt=Math.floor(Date.now()/1000)+65;
  const protocol="katosync-mesh-inbox-recipient-v1";
  const payload=[protocol,OWNER,TARGET,action,requestId,nonce,String(expiresAt)].join("|");
  return {protocol,deviceId:TARGET,action,requestId,nonce,expiresAt,
   signature:b64(new Uint8Array(await crypto.subtle.sign("Ed25519",recipient.privateKey,enc.encode(payload))))};
 }
 return {offer,proof,senderPublic,recipientPublic};
}
function req(body:unknown){
 return new Request("https://local-mesh-qa.invalid",{method:"POST",
  headers:{authorization:"Bearer qa-signed-test-bearer-long-enough-for-filter",
   "content-type":"application/json"},body:JSON.stringify(body)});
}
test("real PostgreSQL-backed signed Edge send→list→accept/reject/replay/key rotation",async()=>{
 const d=await setup(),b=backend();
 const sent=await submitSignedMeshInvite(req(await d.offer()),env,b.request);
 assert.equal(sent.status,202,JSON.stringify(await sent.clone().json()));
 const one=await sent.json();
 assert.equal(one.paired,false);
 const listed=await handleMeshInboxReceive(req(await d.proof("list")),env,b.request);
 assert.equal(listed.status,200,JSON.stringify(await listed.clone().json()));
 const box=await listed.json();
 assert.equal(box.invitations.length,1);
 assert.equal(box.invitations[0].requestId,one.requestId);
 assert.deepEqual([box.paired,box.transportReady,box.remoteJobsEnabled],[false,false,false]);
 const signedAccept=await d.proof("accept",one.requestId);
 const accepted=await handleMeshInboxReceive(req(signedAccept),env,b.request);
 assert.equal(accepted.status,200,JSON.stringify(await accepted.clone().json()));
 assert.equal((await accepted.json()).state,"accepted");
 const replay=await handleMeshInboxReceive(req(signedAccept),env,b.request);
 assert.equal(replay.status,409);
 const second=await handleMeshInboxReceive(req(await d.proof("reject",one.requestId)),env,b.request);
 assert.equal(second.status,409);
 const offer2=await submitSignedMeshInvite(req(await d.offer()),env,b.request);
 assert.equal(offer2.status,202);
 const id2=(await offer2.json()).requestId;
 const rejected=await handleMeshInboxReceive(req(await d.proof("reject",id2)),env,b.request);
 assert.equal(rejected.status,200,JSON.stringify(await rejected.clone().json()));
 assert.equal((await rejected.json()).state,"rejected");
 const offer3=await submitSignedMeshInvite(req(await d.offer()),env,b.request);
 assert.equal(offer3.status,202);
 const id3=uuid((await offer3.json()).requestId);
 pg("UPDATE katosync.mesh_devices SET signing_public_key='"+
  b64(new Uint8Array(32).fill(77))+"' WHERE device_id='"+SOURCE+"'");
 const invalidSource=await handleMeshInboxReceive(req(await d.proof("list")),env,b.request);
 assert.equal(invalidSource.status,503);
 assert.equal((await invalidSource.json()).error,"INBOX_SOURCE_UNVERIFIED");
 pg("UPDATE katosync.mesh_devices SET signing_public_key='"+d.senderPublic+
  "' WHERE device_id='"+SOURCE+"'");
 const malicious=backend(true);
 const invalidTarget=await handleMeshInboxReceive(req(await d.proof("accept",id3)),env,malicious.request);
 assert.equal(invalidTarget.status,503);
 assert.equal((await invalidTarget.json()).error,"INBOX_UNAVAILABLE");
 assert.equal(selectRows("mesh_invites","request_id='"+id3+"'","state")[0].state,"pending");
 assert.equal(malicious.counts.denied,1);
 const summary=pg("SELECT json_build_object('invites',(select count(*) from katosync.mesh_invites),"+
  "'trusted',(select count(*) from katosync.mesh_devices where membership_state='trusted'))");
 assert.deepEqual(summary,{invites:3,trusted:0});
 assert.equal(b.counts.writes,3);
 process.stdout.write("MESH_EDGE_PG_REAL_SQL_ED25519_E2E_PASS\n");
});
