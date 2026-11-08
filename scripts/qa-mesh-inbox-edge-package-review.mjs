#!/usr/bin/env node
// NMKato Solutions — STAGE 2W: entirely OFFLINE / READ-ONLY Edge release review.
// No deployments, credentials, HTTP requests, database writes, or generated files.
import {build} from "esbuild";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {verifyLocalContract,validateSnapshot,PROJECT,MIGRATIONS} from "./qa-mesh-inbox-rollout-gate.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const HASHES=Object.freeze({
 "supabase/functions/mesh-inbox-send/index.ts":"a53cd30a75f0a24d0cbab97d10d56679068fb18d0f4e99d4efe9c79e9196a916",
 "supabase/functions/mesh-inbox-send/send.ts":"74d27e69f91140fba8141b55d7bef1f6d96bf7c83226b1df81d4c5d03bd103ba",
 "supabase/functions/mesh-inbox-receive/index.ts":"88acdcfc08a23d39cae92460dfffb28666d8952fa3accce79d0fcc535b2c3b7d",
 "supabase/functions/mesh-inbox-receive/receive.ts":"bd76bbf3fa5c530760b510259f7a4f927c406f0d3c94aaf3e3fdd66dc4f4d099",
 "supabase/functions/mesh-device-enrollment/membership-gate.ts":"a51592178bd4a899b31686125f807836c0fed35de41453f820f459f95bf45f0c"
});
const sha256=b=>createHash("sha256").update(b).digest("hex");
function fail(code){throw Error("MESH_EDGE_PACKAGE_BLOCKED: "+code);}
export async function buildReview(root=ROOT,baseline=null){
 // Gate rejects any SQL byte change; do not "normalize" CRLF to pass a review.
 const {versions}=verifyLocalContract(root);
 const files=Object.entries(HASHES).map(([name,expected])=>{
   const raw=readFileSync(join(root,name));
   const actual=sha256(raw);
   if(actual!==expected)fail("EDGE_SOURCE_HASH_CHANGED_"+name.replaceAll("/","_"));
   return {name,sha256:actual};
 });
 const bundles=[];
 for(const [name,entry] of [
   ["mesh-inbox-send","supabase/functions/mesh-inbox-send/index.ts"],
   ["mesh-inbox-receive","supabase/functions/mesh-inbox-receive/index.ts"]
 ]){
   const result=await build({entryPoints:[join(root,entry)],absWorkingDir:root,
      bundle:true,platform:"neutral",format:"esm",target:"es2022",write:false,
      logLevel:"silent",metafile:true});
   if(result.outputFiles.length!==1)fail("AMBIGUOUS_BUNDLE");
   const content=result.outputFiles[0].contents;
   const source=Buffer.from(content).toString("utf8");
   const inputs=Object.keys(result.metafile.inputs).map(x=>x.replaceAll("\\","/"));
   if(!source.includes("Deno.serve")||!source.includes("INBOX_NOT_CONFIGURED")||
      !source.includes("remoteJobsEnabled")||!source.includes("paired")||
      !inputs.some(x=>x.endsWith("membership-gate.ts"))||
      (name==="mesh-inbox-receive"&&!inputs.some(x=>x.endsWith("mesh-inbox-send/send.ts"))))
        fail("MISSING_SECURITY_DEPENDENCY_"+name);
   bundles.push({name,sha256:sha256(content),byteLength:content.length,
     entrypoint:entry,jwtVerificationRequired:true,stageFlagDefault:"disabled"});
 }
 // Snapshot is supplementary. It is reviewed offline, NEVER queried from here.
 const inventory=baseline?validateSnapshot(baseline,"baseline"):null;
 if(inventory&&inventory.result!=="BASELINE_MATCHES_REVIEW_ONLY")fail("BASELINE_UNSAFE");
 return Object.freeze({
  result:"REVIEW_ONLY_NO_DEPLOYMENT",projectRef:PROJECT,
  migrationOrder:versions.slice(-4),
  migrationHashes:MIGRATIONS.filter(x=>x.kind==="inbox")
    .map(({version,name,sha256})=>({version,name,sha256})),
  sourceFiles:files,edgeBundles:bundles,baseline:inventory,
  jwtVerificationRequired:true,activationFlagsApplied:false,
  authorizedToDeploy:false,trustEnabled:false,remoteJobsEnabled:false
 });
}
export async function run(args=process.argv.slice(2),root=ROOT){
 if(args.length!==2||args[0]!=="--snapshot")fail("REQUIRES_OFFLINE_BASELINE_SNAPSHOT");
 const filename=args[1];
 if(!filename||filename.length>512||/^[a-z][a-z0-9+.-]*:\/\//i.test(filename))
   fail("LOCAL_SNAPSHOT_ONLY");
 let snapshot;
 try{
  const raw=readFileSync(filename,"utf8");
  if(raw.length>65536)fail("SNAPSHOT_TOO_LARGE");
  snapshot=JSON.parse(raw);
 }catch(e){
  if(String(e).includes("MESH_EDGE_PACKAGE_BLOCKED"))throw e;
  fail("SNAPSHOT_UNAVAILABLE");
 }
 return buildReview(root,snapshot);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(await run(),null,2)+"\n");}
 catch(e){process.stderr.write(String(e.message??e)+"\n");process.exitCode=2;}
}
