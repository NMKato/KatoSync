// KatoSync Stage4E — the new owner-authenticated cancellation facade.
// Networkless tests, synthetic identities, no SQL or production deployment.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {handleInboxTerminalOwnerQA,type Env} from
 "../supabase/functions/mesh-inbox-terminal-owner-qa/handler.ts";

const OWNER="11111111-1111-4111-8111-111111111111";
const FOREIGN="22222222-2222-4222-8222-222222222222";
const REQUEST="33333333-3333-4333-8333-333333333333";
const QA="https://abcdefghijklmnopqrst.supabase.co";
const LIVE="https://xbnnlyyxiilklsygxcof.supabase.co";
const ANON="only-test-anon-key-01234567890123456789";
const SERVICE="only-test-service-key-01234567890123456789";
const JWT="Bearer "+"a".repeat(50)+"."+"b".repeat(50)+"."+"c".repeat(50);
const valid:Env={
 SUPABASE_URL:QA,SUPABASE_ANON_KEY:ANON,SUPABASE_SERVICE_ROLE_KEY:SERVICE,
 KATOSYNC_INBOX_TERMINAL_OWNER_STAGE:"qa-cancel-only",
 KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF:"abcdefghijklmnopqrst"
};
function post(body:unknown={action:"cancel",requestId:REQUEST},token=JWT){
 return new Request("https://qa.example/owner-cancel",{
  method:"POST",headers:{authorization:token,"content-type":"application/json"},
  body:JSON.stringify(body)
 });
}
type Mode="active"|"none"|"suspended"|"unavailable"|"corrupt";
function network(opts:{
 owner?:string;anonymous?:boolean;role?:string;members?:Mode[];
 rpc?:unknown;rpcStatus?:number;authStatus?:number;redirect?:boolean;
}={}){
 const calls:string[]=[];let memberCalls=0,rpcCalls=0,keysLogged=0;
 const fetcher:typeof fetch=async(input,init)=>{
  const u=new URL(input instanceof Request?input.url:String(input));
  assert.equal(u.origin,QA,"no mixed project or upstream redirect");
  assert.equal(init?.redirect,"error");assert.equal(init?.cache,"no-store");
  calls.push(u.pathname);
  if(u.pathname==="/auth/v1/user"){
   const headers=init?.headers as Record<string,string>;
   assert.equal(headers.Authorization,JWT);
   assert.equal(headers.apikey,ANON);
   assert.equal(headers.Authorization.includes(SERVICE),false);
   if(opts.authStatus)return new Response("auth failure",{status:opts.authStatus});
   if(opts.redirect)return Response.redirect("https://other.example",302);
   return Response.json({id:opts.owner??OWNER,role:opts.role??"authenticated",
    is_anonymous:opts.anonymous??false});
  }
  if(u.pathname==="/rest/v1/account_memberships"){
   const headers=init?.headers as Record<string,string>;
   assert.equal(headers.apikey,SERVICE);
   assert.equal(headers.Authorization,"Bearer "+SERVICE);
   assert.equal(u.searchParams.get("user_id"),"eq."+(opts.owner??OWNER));
   assert.equal(u.searchParams.get("limit"),"2");
   assert.equal(u.searchParams.get("select"),"user_id,access_state,authorized_at,revoked_at");
   const mode=opts.members?.[memberCalls++]??"active";
   if(mode==="unavailable")return new Response("down",{status:503});
   if(mode==="none")return Response.json([]);
   if(mode==="corrupt")return Response.json([{user_id:"wrong",access_state:"active"}]);
   return Response.json([{user_id:opts.owner??OWNER,access_state:mode,
    authorized_at:"2026-11-01T00:00:00Z",revoked_at:null}]);
  }
  if(u.pathname==="/rest/v1/rpc/mesh_inbox_terminal_close_qa"){
   rpcCalls++;
   assert.equal(init?.method,"POST");
   assert.equal(init?.cache,"no-store");
   assert.equal((init?.headers as Record<string,string>)["Content-Profile"],"katosync");
   assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer "+SERVICE);
   assert.deepEqual(JSON.parse(String(init?.body)),{
    p_owner:opts.owner??OWNER,p_request:REQUEST,p_terminal:"cancelled"
   });
   keysLogged+=(String(init?.body).includes(SERVICE)?1:0);
   return Response.json(opts.rpc===undefined?"closed":opts.rpc,{status:opts.rpcStatus??200});
  }
  throw Error("unexpected-path:"+u.pathname);
 };
 return {fetcher,calls,counts:()=>({memberCalls,rpcCalls,keysLogged})};
}
test("QA requires explicit tenant, never allows LIVE project or implicit privileges",async()=>{
 for(const e of [
  {...valid,KATOSYNC_INBOX_TERMINAL_OWNER_STAGE:""},
  {...valid,KATOSYNC_INBOX_TERMINAL_OWNER_STAGE:"qa"},
  {...valid,KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF:""},
  {...valid,KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF:"xbnnlyyxiilklsygxcof"},
  {...valid,SUPABASE_URL:LIVE,KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF:"xbnnlyyxiilklsygxcof"},
  {...valid,SUPABASE_URL:"https://evil.test"},
  {...valid,SUPABASE_URL:QA+"/untrusted"},
  {...valid,SUPABASE_SERVICE_ROLE_KEY:ANON}
 ]){
  let called=0;
  const response=await handleInboxTerminalOwnerQA(post(),e,{fetcher:async()=>{
   called++;throw Error("unauthorized network");
  }});
  assert.equal(response.status,503);
  assert.equal(called,0);
 }
});
test("invalid method, JSON type, bearer, body or attempted owner substitution never reach network",async()=>{
 const malformed=[
  post({action:"accept",requestId:REQUEST}),
  post({action:"cancel",requestId:REQUEST,ownerId:FOREIGN}),
  post({action:"cancel",requestId:"not-a-uuid"}),
  post({action:"cancel",requestId:REQUEST,remoteJobsEnabled:true}),
  post(["cancel",REQUEST]),
  post({action:"expired",requestId:REQUEST}),
  post({action:"cancel",requestId:REQUEST},"Bearer "+SERVICE),
  post({action:"cancel",requestId:REQUEST},"Bearer "+"sb_secret_"+"z".repeat(40)),
  post({action:"cancel",requestId:REQUEST},"Bearer NotAJwt"),
  new Request("https://qa.example/owner-cancel",{method:"GET"}),
  new Request("https://qa.example/owner-cancel",{
   method:"POST",headers:{authorization:JWT,"content-type":"text/plain"},body:"{}"})
 ];
 for(const request of malformed){
  let calls=0;
  const response=await handleInboxTerminalOwnerQA(request,valid,{fetcher:async()=>{
   calls++;throw Error("network");
  }});
  assert.ok([400,401,405,415].includes(response.status),String(response.status));
  assert.equal(calls,0);
 }
});
test("JWT-shaped service_role bearer and oversized user payload are rejected before Auth",async()=>{
 const serviceJwt=JWT.slice(7);
 const unauthorized=await handleInboxTerminalOwnerQA(post(undefined,JWT),{
  ...valid,SUPABASE_SERVICE_ROLE_KEY:serviceJwt
 },{fetcher:async()=>{throw Error("service-role caller hit network");}});
 assert.equal(unauthorized.status,401);
 const huge=post({action:"cancel",requestId:REQUEST,filler:"x".repeat(400)});
 const blocked=await handleInboxTerminalOwnerQA(huge,valid,{
  fetcher:async()=>{throw Error("oversize request hit network");}});
 assert.equal(blocked.status,400);
});

test("only fresh authenticated, non-anonymous KATOOS user may authorize a cancellation",async()=>{
 for(const config of [
  {owner:"invalid-uid"},{anonymous:true},{role:"service_role"},
  {role:"anon"},{authStatus:401},{redirect:true}
 ]){
  const n=network(config);
  const res=await handleInboxTerminalOwnerQA(post(),valid,{fetcher:n.fetcher});
  assert.equal(res.status,401);
  assert.equal(n.counts().rpcCalls,0);
 }
});
test("no KatoSync membership, suspension, malformed membership or outage fails closed",async()=>{
 for(const [mode,status] of [["none",403],["suspended",403],
  ["corrupt",503],["unavailable",503]] as const){
  const n=network({members:[mode]});
  const res=await handleInboxTerminalOwnerQA(post(),valid,{fetcher:n.fetcher});
  assert.equal(res.status,status,mode);
  assert.equal(n.counts().rpcCalls,0);
 }
});
test("membership revoked or unavailable immediately before RPC prevents service-role write",async()=>{
 for(const [mode,status] of [["none",403],["unavailable",503],
  ["suspended",403]] as const){
  const n=network({members:["active",mode]});
  const response=await handleInboxTerminalOwnerQA(post(),valid,{fetcher:n.fetcher});
  assert.equal(response.status,status);
  assert.equal(n.counts().memberCalls,2);
  assert.equal(n.counts().rpcCalls,0);
 }
});
test("valid owner triggers ONLY owner-scoped cancel RPC and never grants device trust",async()=>{
 const n=network();
 const response=await handleInboxTerminalOwnerQA(post(),valid,{fetcher:n.fetcher});
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{
  requestId:REQUEST,state:"cancelled",alreadyClosed:false,
  paired:false,transportReady:false,remoteJobsEnabled:false});
 assert.deepEqual(n.calls,["/auth/v1/user","/rest/v1/account_memberships",
  "/rest/v1/account_memberships","/rest/v1/rpc/mesh_inbox_terminal_close_qa"]);
 assert.equal(n.counts().keysLogged,0);
});
test("SQL terminal result controls idempotence and denies cross-owner/not-pending outcomes",async()=>{
 for(const [result,status,error] of [
  ["already_closed",200,null],["not_found",404,"INVITE_NOT_FOUND"],
  ["not_pending",409,"INVITE_NOT_CANCELLABLE"],
  ["wrong_deadline",409,"INVITE_NOT_CANCELLABLE"],
  ["unexpected",503,"INBOX_TERMINAL_UNAVAILABLE"]
 ] as const){
  const n=network({rpc:result});
  const response=await handleInboxTerminalOwnerQA(post(),valid,{fetcher:n.fetcher});
  assert.equal(response.status,status);
  const data=await response.json();
  if(error)assert.equal(data.error,error);
  else assert.equal(data.alreadyClosed,true);
  assert.equal(n.counts().rpcCalls,1);
 }
});
test("a foreign authenticated owner is never mapped to the request's original owner",async()=>{
 const n=network({owner:FOREIGN,rpc:"not_found"});
 const res=await handleInboxTerminalOwnerQA(post(),valid,{fetcher:n.fetcher});
 assert.equal(res.status,404);
 assert.equal(n.counts().rpcCalls,1);
});
test("new sb_secret_ API keys stay in apikey only, never as a fake JWT",async()=>{
 const secret="sb_secret_"+"z".repeat(45);
 const env={...valid,SUPABASE_SERVICE_ROLE_KEY:secret};
 let policyReads=0,mutations=0;
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  assert.equal(url.origin,QA);
  assert.equal(init?.redirect,"error");
  const h=init?.headers as Record<string,string>;
  if(url.pathname==="/auth/v1/user"){
   assert.equal(h.Authorization,JWT);assert.equal(h.apikey,ANON);
   return Response.json({id:OWNER,role:"authenticated",is_anonymous:false});
  }
  assert.equal(h.apikey,secret);assert.equal("Authorization" in h,false);
  if(url.pathname==="/rest/v1/account_memberships"){
   policyReads++;
   return Response.json([{user_id:OWNER,access_state:"active",
    authorized_at:"2026-11-01T00:00:00Z",revoked_at:null}]);
  }
  if(url.pathname==="/rest/v1/rpc/mesh_inbox_terminal_close_qa"){
   mutations++;
   return Response.json("closed");
  }
  throw Error("unrecognized test route");
 };
 const res=await handleInboxTerminalOwnerQA(post(),env,{fetcher});
 assert.equal(res.status,200);assert.equal(policyReads,2);assert.equal(mutations,1);
 const bad=await handleInboxTerminalOwnerQA(post(),{
  ...valid,SUPABASE_SERVICE_ROLE_KEY:"sb_publishable_"+"p".repeat(40)
 },{fetcher:async()=>{throw Error("cannot call public-key-as-service");}});
 assert.equal(bad.status,503);
});
test("RPC failure, upstream malformed reply and network exceptions never produce success",async()=>{
 for(const config of [{rpcStatus:503},{rpc:{state:"cancelled"}},
  {rpc:["closed"]},{rpc:null}]){
  const n=network(config);
  const response=await handleInboxTerminalOwnerQA(post(),valid,{fetcher:n.fetcher});
  assert.equal(response.status,503);
 }
 const response=await handleInboxTerminalOwnerQA(post(),valid,{
  fetcher:async()=>{throw Error("offline");}
 });
 assert.equal(response.status,503);
});
test("new handler and Deno entrypoint are isolated, both bundle for QA only",async()=>{
 const root=new URL("../",import.meta.url);
 const files=["supabase/functions/mesh-inbox-terminal-owner-qa/handler.ts",
  "supabase/functions/mesh-inbox-terminal-owner-qa/index.ts"];
 for(const relative of files){
  const url=new URL(relative,root);
  const result=await build({entryPoints:[fileURLToPath(url)],bundle:true,
   write:false,platform:"neutral",format:"esm",target:"es2022",logLevel:"silent"});
  assert.equal(result.outputFiles.length,1);
  assert.match(Buffer.from(result.outputFiles[0].contents).toString("utf8"),/INBOX_TERMINAL_QA_DISABLED/);
 }
 const original=readFileSync(new URL("../supabase/functions/mesh-inbox-receive/receive.ts",import.meta.url),"utf8");
 assert.match(original,/verifyDeviceProof/);
});
