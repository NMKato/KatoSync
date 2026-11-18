// NMKato Solutions — Stage 2X: EXECUTE the true Edge entrypoint and its bundled
// imports in Node's Web-Request runtime with a narrowly mocked Deno.serve.
// No Supabase access, credentials, sockets, application changes or DB writes.
import {test} from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {resolve,dirname,join} from "node:path";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const endpointCases=[
 {name:"mesh-inbox-send",stage:"KATOSYNC_MESH_INBOX_STAGE",enabled:"send-only"},
 {name:"mesh-inbox-receive",stage:"KATOSYNC_MESH_INBOX_RECEIVE_STAGE",enabled:"qa-inbox"}
] as const;
type EnvMap=Record<string,string>;
type Handler=(r:Request)=>Promise<Response>;
const fakeUserBearer="Bearer "+("a".repeat(50));

async function compileEntrypoint(name:string){
 const result=await build({
   entryPoints:[join(ROOT,"supabase","functions",name,"index.ts")],
   absWorkingDir:ROOT,write:false,bundle:true,platform:"neutral",
   format:"esm",target:"es2022",logLevel:"silent"
 });
 assert.equal(result.outputFiles.length,1);
 return Buffer.from(result.outputFiles[0].contents).toString("utf8");
}
async function inHermeticRuntime(source:string,vars:EnvMap,run:(handler:Handler,access:{networkCalls:number})=>Promise<void>){
 const originalDeno=(globalThis as Record<string,unknown>).Deno;
 const originalFetch=globalThis.fetch;
 let handler:Handler|null=null;
 const access={networkCalls:0};
 (globalThis as Record<string,unknown>).Deno={
  env:{get:(key:string)=>vars[key]??undefined},
  serve:(fn:Handler)=>{if(handler)throw Error("MULTIPLE_DENO_LISTENERS");handler=fn;}
 };
 globalThis.fetch=(async()=>{
  access.networkCalls++;
  throw Error("HERMETIC_NETWORK_ACCESS_DENIED");
 }) as typeof fetch;
 try{
  // Unique, data-only import executes both the production index.ts and its
  // actual modules without Node file-system writes, Deno sockets or secrets.
  const mod="data:text/javascript;base64,"+Buffer.from(source+
    "\n// test isolated instance: "+crypto.randomUUID()).toString("base64");
  await import(mod);
  if(!handler)throw Error("PRODUCTION_DENO_ENTRYPOINT_NOT_REGISTERED");
  await run(handler,access);
  assert.equal(access.networkCalls,0,"Edge touched network before QA activation");
 }finally{
  globalThis.fetch=originalFetch;
  if(originalDeno===undefined)delete (globalThis as Record<string,unknown>).Deno;
  else (globalThis as Record<string,unknown>).Deno=originalDeno;
 }
}
function post(headers:Record<string,string>={}):Request{
 return new Request("https://synthetic-qa.invalid/mesh",{method:"POST",
   headers:{"content-type":"application/json",...headers},body:"{}"});
}
const localVars={
 SUPABASE_URL:"https://xbnnlyyxiilklsygxcof.supabase.co",
 SUPABASE_ANON_KEY:"test-only-publishable",
 SUPABASE_SERVICE_ROLE_KEY:"test-only-NOT-a-real-service-role-key"
};

test("real production Deno entrypoints, fully bundled, stay dark with missing or wrong rollout flags",async()=>{
 for(const {name,stage} of endpointCases){
  const source=await compileEntrypoint(name);
  for(const vars of [
   {},localVars,{...localVars,[stage]:""}, {...localVars,[stage]:"wrong-stage"},
   {...localVars,[stage]:name==="mesh-inbox-send"?"send-only":"qa-inbox",
       SUPABASE_URL:"https://unexpected.invalid"}
  ]){
   await inHermeticRuntime(source,vars,async handler=>{
    const r=await handler(post({authorization:fakeUserBearer}));
    assert.equal(r.status,503,name+" failed to deny unapproved deployment");
    assert.deepEqual(await r.json(),{error:"INBOX_NOT_CONFIGURED"});
    assert.equal(r.headers.get("cache-control"),"no-store");
   });
  }
 }
});
test("enabled QA flags still require server-only secrets, reject unauthenticated and malformed requests before network",async()=>{
 for(const {name,stage,enabled} of endpointCases){
  const code=await compileEntrypoint(name);
  await inHermeticRuntime(code,{...localVars,[stage]:enabled,
    SUPABASE_SERVICE_ROLE_KEY:""},async handler=>{
      const r=await handler(post({authorization:fakeUserBearer}));
      assert.equal(r.status,503);
      assert.deepEqual(await r.json(),{error:"INBOX_NOT_CONFIGURED"});
  });
  await inHermeticRuntime(code,{...localVars,[stage]:enabled},async handler=>{
    const get=await handler(new Request("https://synthetic-qa.invalid/mesh"));
    assert.equal(get.status,405);
    assert.equal((await get.json()).error,"METHOD_NOT_ALLOWED");
    const unauth=await handler(post());
    assert.equal(unauth.status,401);
    assert.equal((await unauth.json()).error,"LOGIN_REQUIRED");
    const malformed=await handler(post({authorization:fakeUserBearer}));
    assert.equal(malformed.status,400);
    assert.equal((await malformed.json()).error,
       name==="mesh-inbox-send"?"BAD_INVITE":"BAD_PROOF");
  });
 }
});
