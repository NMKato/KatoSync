// NMKato Solutions — Stage 3K, real Rust-signed Edge handler + ephemeral PG17.
// Only a synthetic local JWT/membership adapter is mocked. No Cloud traffic.
import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {handleMeshPairingRelay} from "../supabase/functions/mesh-pairing-relay/relay.ts";

const SOCK=process.env.KATOSYNC_MESH_E2E_SOCKET??"";
const PORT=process.env.KATOSYNC_MESH_E2E_PORT??"";
if(!/^\/tmp\/ksmeshqa\.[A-Za-z0-9]{6}$/.test(SOCK)||PORT!=="55439"||
 process.env.KATOSYNC_MESH_E2E_ALLOW!=="EPHEMERAL_UNIX_SOCKET_ONLY")
 throw Error("STAGE3K_DISPOSABLE_SOCKET_REQUIRED");
const input=process.env.KATOSYNC_STAGE3K_RUST_FIXTURE??"";
if(!/^\/(?:private\/)?tmp\/katosync-stage3k-[A-Za-z0-9]+\/rust-public\.json$/.test(input))
 throw Error("STAGE3K_FRESH_RUST_FIXTURE_REQUIRED");
const f=JSON.parse(readFileSync(input,"utf8"));
if(!f.fixtureOnly||f.generatedBy!=="rust-production-ed25519-dalek-serde"||
 Math.abs(f.nowMs-Date.now())>90_000)throw Error("STAGE3K_INVALID_NATIVE_FIXTURE");
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const OWNER="11111111-1111-4111-8111-111111111111";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{43}$/;
const env={SUPABASE_URL:ORIGIN,SUPABASE_ANON_KEY:"qa-public-only",
 SUPABASE_SERVICE_ROLE_KEY:"synthetic-local-role-never-cloud",
 KATOSYNC_MESH_PAIRING_RELAY_STAGE:"qa-relay"};
function id(s:string):string{if(!UUID.test(s))throw Error("STAGE3K_BAD_UUID");return s;}
function key(s:string):string{if(!KEY.test(s))throw Error("STAGE3K_BAD_PUBLIC_KEY_OR_NONCE");return s;}
function sqlJson(v:unknown):string{
 return "convert_from(decode('"+Buffer.from(JSON.stringify(v)).toString("base64")+"','base64'),'UTF8')::jsonb";
}
function pg(query:string,service=false):any{
 const r=spawnSync("/opt/homebrew/opt/postgresql@17/bin/psql",[
 "-X","-q","-t","-A","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose",
 "-h",SOCK,"-p",PORT,"-U","postgres","-d","postgres",
 "-c",(service?"SET ROLE service_role;\n":"")+query
 ],{encoding:"utf8",timeout:8_000,env:{PATH:"/usr/bin:/bin",HOME:"/tmp",LANG:"C"}});
 if(r.error)throw r.error;
 if(r.status!==0)throw Error("STAGE3K_LOCAL_PG_REJECTED "+r.stderr.slice(0,700));
 const out=r.stdout.trim();
 return out?JSON.parse(out):null;
}
function rows(table:string,where:string,columns:string,order=""):any[]{
 const data=pg("SELECT coalesce(json_agg(t),'[]'::json) FROM (SELECT "+
  columns+" FROM katosync."+table+" WHERE "+where+" "+order+" LIMIT 10) t",true);
 if(!Array.isArray(data))throw Error("STAGE3K_PG_BAD_ROWS");
 return data;
}
function errorResponse(error:unknown){
 const message=String(error);
 const status=message.includes("23505")?409:503;
 return Response.json({error:"QA_DATABASE_DENIED"},{status});
}
function putFixtureInLocalDb(){
 assert.equal(f.owner,OWNER);
 const source=id(f.sourceDeviceId),target=id(f.targetDeviceId),request=id(f.requestId);
 const a=key(f.sourcePublicKey),b=key(f.targetPublicKey);
 const invite=f.invite;
 assert.equal(invite.request_id,request);
 assert.equal(invite.owner_user_id,OWNER);
 assert.equal(invite.source_device_id,source);
 assert.equal(invite.target_device_id,target);
 assert.equal(invite.state,"accepted");
 const offer=invite.signed_offer;
 key(offer.nonce);key(offer.publicKey);
 assert.equal(offer.publicKey,a);
 assert.ok(offer.expiresAt*1000>Date.now());
 pg("INSERT INTO katosync.mesh_devices "+
  "(device_id,owner_user_id,signing_public_key,fingerprint,display_name,platform_os) VALUES "+
  "('"+source+"','"+OWNER+"','"+a+"','"+Array(16).fill("AA").join("-")+"','Synthetic A','macos'),"+
  "('"+target+"','"+OWNER+"','"+b+"','"+Array(16).fill("BB").join("-")+"','Synthetic B','macos')");
 pg("INSERT INTO katosync.mesh_invites "+
  "(request_id,owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at) VALUES "+
  "('"+request+"','"+OWNER+"','"+source+"','"+target+"','"+offer.nonce+"',"+
  sqlJson(offer)+",'"+("S".repeat(86))+"',to_timestamp("+Number(offer.expiresAt)+"))");
 // Legitimate database-bound synthetic accept proof (not a live user approval).
 pg("INSERT INTO katosync.mesh_inbox_proofs "+
  "(owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at) VALUES "+
  "('"+OWNER+"','"+target+"','"+b+"','"+("R".repeat(43))+"','accept','"+request+
  "',now()+interval '60 seconds')");
 pg("UPDATE katosync.mesh_invites i SET state='accepted',resolved_at=now(),"+
  "resolution_proof_id=p.proof_id FROM katosync.mesh_inbox_proofs p WHERE "+
  "p.request_id=i.request_id AND p.action='accept'");
 assert.equal(rows("mesh_invites","request_id='"+request+"'","state")[0]?.state,"accepted");
}
function backend(){
 const counts={auth:0,sqlWrites:0,sqlReads:0,proofs:0};
 const request=async(resource:RequestInfo|URL,options?:RequestInit):Promise<Response>=>{
  const url=new URL(String(resource));
  if(url.origin!==ORIGIN)throw Error("STAGE3K_NO_EXTERNAL_NETWORK");
  const method=options?.method??"GET";
  if(url.pathname==="/auth/v1/user"){
   counts.auth++;
   return Response.json({id:OWNER,is_anonymous:false});
  }
  if(url.pathname==="/rest/v1/account_memberships")
   return Response.json([{user_id:OWNER,access_state:"active",
    authorized_at:"2026-10-30T12:00:00Z",revoked_at:null}]);
  assert.ok(url.pathname.startsWith("/rest/v1/"));
  const headers=options?.headers as Record<string,string>;
  assert.equal(headers?.[method==="GET"?"Accept-Profile":"Content-Profile"],"katosync");
  if(url.pathname==="/rest/v1/mesh_devices"&&method==="GET"){
   assert.equal(url.searchParams.get("owner_user_id"),"eq."+OWNER);
   const filter=url.searchParams.get("device_id")??"";
   assert.ok(filter.startsWith("in.(")&&filter.endsWith(")"));
   const ids=filter.slice(4,-1).split(",").map(id);
   assert.ok(ids.length>0&&ids.length<=2);
   return Response.json(rows("mesh_devices","owner_user_id='"+OWNER+
    "' AND device_id IN ("+ids.map(x=>"'"+x+"'").join(",")+")",
    "device_id,owner_user_id,signing_public_key,membership_state,revoked_at"));
  }
  if(url.pathname==="/rest/v1/mesh_invites"&&method==="GET"){
   assert.equal(url.searchParams.get("owner_user_id"),"eq."+OWNER);
   const requestId=id((url.searchParams.get("request_id")??"").replace(/^eq\./,""));
   return Response.json(rows("mesh_invites","owner_user_id='"+OWNER+
    "' AND request_id='"+requestId+"'",
    "request_id,owner_user_id,source_device_id,target_device_id,state,expires_at,signed_offer"));
  }
  if(url.pathname==="/rest/v1/mesh_pairing_relay_messages"&&method==="POST"){
   counts.sqlWrites++;
   const body=JSON.parse(String(options?.body));
   assert.equal(body.owner_user_id,OWNER);
   assert.equal(body.request_id,f.requestId);
   const query="WITH b AS (SELECT "+sqlJson(body)+" j), a AS ("+
    "INSERT INTO katosync.mesh_pairing_relay_messages "+
    "(owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at) "+
    "SELECT (j->>'owner_user_id')::uuid,(j->>'request_id')::uuid,"+
    "(j->>'sender_device_id')::uuid,(j->>'recipient_device_id')::uuid,"+
    "j->>'kind',j->>'payload_b64',j->>'nonce',j->>'signature',"+
    "(j->>'expires_at')::timestamptz FROM b "+
    "RETURNING message_id,owner_user_id,request_id,sender_device_id,recipient_device_id,kind) "+
    "SELECT coalesce(json_agg(a),'[]'::json) FROM a";
   try{return Response.json(pg(query,true),{status:201});}
   catch(e){return errorResponse(e);}
  }
  if(url.pathname==="/rest/v1/mesh_pairing_relay_messages"&&method==="GET"){
   counts.sqlReads++;
   assert.equal(url.searchParams.get("owner_user_id"),"eq."+OWNER);
   const recipient=id((url.searchParams.get("recipient_device_id")??"").replace(/^eq\./,""));
   return Response.json(rows("mesh_pairing_relay_messages","owner_user_id='"+OWNER+
    "' AND recipient_device_id='"+recipient+"' AND expires_at>now()",
    "message_id,owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at",
    "ORDER BY created_at DESC"));
  }
  if(url.pathname==="/rest/v1/mesh_pairing_relay_reads"&&method==="POST"){
   counts.proofs++;
   const body=JSON.parse(String(options?.body));
   assert.equal(body.owner_user_id,OWNER);
   const query="WITH b AS (SELECT "+sqlJson(body)+" j), a AS ("+
    "INSERT INTO katosync.mesh_pairing_relay_reads "+
    "(owner_user_id,device_id,nonce,expires_at) SELECT "+
    "(j->>'owner_user_id')::uuid,(j->>'device_id')::uuid,"+
    "j->>'nonce',(j->>'expires_at')::timestamptz FROM b "+
    "RETURNING proof_id,owner_user_id,device_id,nonce,expires_at) "+
    "SELECT coalesce(json_agg(a),'[]'::json) FROM a";
   try{return Response.json(pg(query,true),{status:201});}
   catch(e){return errorResponse(e);}
  }
  throw Error("STAGE3K_UNRECOGNIZED_LOCAL_REST_ROUTE");
 };
 return {request:request as typeof fetch,counts};
}
function req(action:"send"|"list",payload:unknown){
 return new Request("https://local-qa.invalid/edge",{method:"POST",headers:{
  authorization:"Bearer purely-synthetic-bearer-00000000000000000",
  "content-type":"application/json"},body:JSON.stringify({action,payload})});
}
test("Rust-signed B->A Challenge and A->B Response pass real Edge+PostgreSQL",async()=>{
 putFixtureInLocalDb();
 const b=backend();
 const premature=await handleMeshPairingRelay(req("send",f.response),env,b.request);
 assert.equal(premature.status,503,"database must prevent Response before Challenge");
 let result=await handleMeshPairingRelay(req("send",f.challenge),env,b.request);
 assert.equal(result.status,202,JSON.stringify(await result.clone().json()));
 assert.equal((await result.json()).paired,false);
 result=await handleMeshPairingRelay(req("list",f.listInitiator),env,b.request);
 assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
 assert.deepEqual((await result.json()).messages,[f.challenge]);
 result=await handleMeshPairingRelay(req("send",f.response),env,b.request);
 assert.equal(result.status,202,JSON.stringify(await result.clone().json()));
 result=await handleMeshPairingRelay(req("list",f.listRecipient),env,b.request);
 assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
 const payload=await result.json();
 assert.deepEqual(payload.messages,[f.response]);
 assert.deepEqual([payload.paired,payload.transportReady,payload.remoteJobsEnabled],[false,false,false]);
 result=await handleMeshPairingRelay(req("list",f.listInitiator),env,b.request);
 assert.equal(result.status,409,"SQL must deny repeated signed-read nonce");
 result=await handleMeshPairingRelay(req("send",
  {...f.challenge,signature:"A".repeat(86)}),env,b.request);
 assert.equal(result.status,403,"Edge must deny forged Rust envelope");
 // Live SQL device state (not a mock flag) must cause Edge to fail closed.
 pg("UPDATE katosync.mesh_devices SET membership_state='revoked',revoked_at=now() "+
  "WHERE device_id='"+id(f.targetDeviceId)+"'");
 result=await handleMeshPairingRelay(req("send",f.response),env,b.request);
 assert.equal(result.status,403,"revoked recipient cannot send or receive new relay data");
 assert.deepEqual(pg("SELECT json_build_object("+
  "'messages',(select count(*) from katosync.mesh_pairing_relay_messages),"+
  "'proofs',(select count(*) from katosync.mesh_pairing_relay_reads),"+
  "'trusted',(select count(*) from katosync.mesh_devices where membership_state='trusted'))"),
  {messages:2,proofs:2,trusted:0});
 assert.ok(b.counts.auth>=6);
 assert.equal(b.counts.sqlWrites,3);
 assert.equal(b.counts.sqlReads,2);
 assert.equal(b.counts.proofs,3);
 console.log("STAGE3K_RUST_EDGE_REAL_POSTGRES_PASS");
});
