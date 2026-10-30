#!/usr/bin/env node
// NMKato Solutions Stage 3B: real Deno server, unchanged production handler,
// synthetic-only, 127.0.0.1 loopback. NO shared Supabase cloud or auth secrets.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {build} from "esbuild";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,dirname,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {createServer} from "node:net";
import {buildReview} from "./qa-mesh-inbox-edge-package-review.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const DENIED="MESH_DENO_LOOPBACK_BLOCKED";
const fail=code=>{throw Error(DENIED+": "+code);};
const cases=[
 {name:"mesh-inbox-send",flag:"KATOSYNC_MESH_INBOX_STAGE",value:"send-only",bad:"BAD_INVITE"},
 {name:"mesh-inbox-receive",flag:"KATOSYNC_MESH_INBOX_RECEIVE_STAGE",value:"qa-inbox",bad:"BAD_PROOF"}
];
const permittedEnv="SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,KATOSYNC_MESH_INBOX_STAGE,KATOSYNC_MESH_INBOX_RECEIVE_STAGE";
const syntheticEnv={
 SUPABASE_URL:"https://xbnnlyyxiilklsygxcof.supabase.co",
 SUPABASE_ANON_KEY:"SYNTHETIC-QA-PUBLIC-NOT-A-KEY",
 SUPABASE_SERVICE_ROLE_KEY:"SYNTHETIC-QA-SERVER-NOT-A-KEY"
};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freeLoopbackPort(){
 return new Promise((resolve,reject)=>{
  const s=createServer();s.on("error",reject);
  s.listen(0,"127.0.0.1",()=>{const a=s.address();
    if(!a||typeof a==="string"){s.close();reject(Error("NO_LOCAL_PORT"));return;}
    s.close(err=>err?reject(err):resolve(a.port));
  });
 });
}
async function bundleHandler(name,port){
 const result=await build({
  entryPoints:[join(ROOT,"supabase/functions",name,"index.ts")],
  absWorkingDir:ROOT,bundle:true,format:"esm",platform:"neutral",target:"es2022",
  write:false,logLevel:"silent"
 });
 assert.equal(result.outputFiles.length,1);
 const source=Buffer.from(result.outputFiles[0].contents).toString("utf8");
 // ONLY modify listener transport; the complete original handler + imports
 // are verified byte-for-byte upstream by Stage2W hashes and stay unchanged.
 const start="Deno.serve(";
 if(source.split(start).length!==2)fail("EXPECTED_SINGLE_DENO_LISTENER");
 return source.replace(start,
  'Deno.serve({hostname:"127.0.0.1",port:'+port+'},');
}
async function awaitReady(port,child){
 for(let n=0;n<75;n++){
  if(child.exitCode!==null||child.signalCode!==null)fail("DENO_EXITED_EARLY");
  try{
   const r=await fetch("http://127.0.0.1:"+port+"/ready",
    {method:"HEAD",signal:AbortSignal.timeout(300)});
   await r.body?.cancel();
   return;
  }catch{await sleep(70);}
 }
 fail("DENO_NOT_READY");
}
async function httpCheck(port,method,body,authorization,status,error){
 const h={"content-type":"application/json"};
 if(authorization)h.authorization=authorization;
 const r=await fetch("http://127.0.0.1:"+port+"/mesh",{
  method,headers:h,...(method==="POST"?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(2500)
 });
 assert.equal(r.status,status,"Expected "+status+" for "+error);
 assert.equal((await r.json()).error,error);
 if(status===503)assert.equal(r.headers.get("cache-control"),"no-store");
}
async function runScenario(deno,tmp,kind,mode,report){
 const port=await freeLoopbackPort();
 const output=join(tmp,kind.name+"-"+mode+".mjs");
 await writeFile(output,await bundleHandler(kind.name,port),{mode:0o600});
 const env={HOME:tmp,DENO_DIR:join(tmp,"deno-cache"),DENO_NO_UPDATE_CHECK:"1",
  PATH:process.env.PATH??"/usr/bin:/bin"};
 if(mode==="wrong-stage")Object.assign(env,syntheticEnv,{[kind.flag]:"not-approved"});
 if(mode==="missing-secret")Object.assign(env,syntheticEnv,{[kind.flag]:kind.value,
    SUPABASE_SERVICE_ROLE_KEY:""});
 if(mode==="enabled-with-synthetic-only")Object.assign(env,syntheticEnv,{[kind.flag]:kind.value});
 // Deno permissions: no external hosts, no file system after loading the
 // main script, no subprocess, no FFI, no real Supabase secret or user JWT.
 const child=spawn(deno,[
  "run","--no-prompt","--no-remote",
  "--allow-net=127.0.0.1:"+port,
  "--allow-env="+permittedEnv,
  output],{cwd:tmp,env,stdio:["ignore","pipe","pipe"]});
 let log="";
 for(const stream of [child.stdout,child.stderr])
  stream.on("data",b=>{log=(log+String(b)).slice(-3500);});
 try{
  await awaitReady(port,child);
  const fakeBearer="Bearer "+("a".repeat(50));
  if(mode!=="enabled-with-synthetic-only")
   await httpCheck(port,"POST",{},fakeBearer,503,"INBOX_NOT_CONFIGURED");
  else{
   await httpCheck(port,"GET",null,null,405,"METHOD_NOT_ALLOWED");
   await httpCheck(port,"POST",{},null,401,"LOGIN_REQUIRED");
   await httpCheck(port,"POST",{},fakeBearer,400,kind.bad);
  }
  report.push({entrypoint:kind.name,mode,
   runtime:"REAL_DENO_LOCAL_LOOPBACK",outboundNetworkAllowed:false,
   cloudCredentials:false,realJwtVerified:false,verified:true});
 }catch(e){
  fail(kind.name+"_"+mode+"_FAILED: "+e.message+" "+log.slice(-650));
 }finally{
  child.kill("SIGTERM");
  await new Promise(resolve=>{
   if(child.exitCode!==null||child.signalCode!==null){resolve();return;}
   child.once("close",resolve);
   setTimeout(()=>{child.kill("SIGKILL");resolve();},1500).unref();
  });
 }
}
export async function run(args=process.argv.slice(2)){
 if(args.length!==3||args[0]!=="--synthetic-loopback"||args[1]!=="--deno-bin"||
    typeof args[2]!=="string"||!isAbsolute(args[2]))fail("EXPLICIT_LOCAL_DENO_REQUIRED");
 const deno=args[2];
 const pinned=await buildReview(ROOT);
 assert.equal(pinned.result,"REVIEW_ONLY_NO_DEPLOYMENT");
 const tmp=await mkdtemp(join(tmpdir(),"ksmesh-deno-"));
 const result=[];
 try{
  await mkdir(join(tmp,"deno-cache"),{recursive:true,mode:0o700});
  for(const kind of cases)
   for(const mode of ["off","wrong-stage","missing-secret","enabled-with-synthetic-only"])
    await runScenario(deno,tmp,kind,mode,result);
 }finally{await rm(tmp,{recursive:true,force:true});}
 return {result:"REAL_DENO_LOCAL_LOOPBACK_QA_PASS",
  verifiedScenarios:result.length,entrypoints:result,
  realSupabaseEdgeGateway:false,realJwtVerified:false,
  realPostgrest:false,productionDbTouched:false,
  operatorApproval:false,authorizedToDeploy:false,
  trustEnabled:false,remoteJobsEnabled:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(await run(),null,2)+"\n");}
 catch(e){process.stderr.write(String(e.message??e)+"\n");process.exitCode=2;}
}
