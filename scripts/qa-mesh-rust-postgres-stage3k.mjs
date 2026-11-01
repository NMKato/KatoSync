// NMKato Solutions — Stage 3K Rust Ed25519 -> actual Edge -> actual PostgreSQL.
 // Explicitly local-only: uses cargo --offline and a disposable Unix-socket PG17.
import {spawnSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync,chmodSync,existsSync,mkdirSync,rmdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
if(process.platform!=="darwin")throw Error("STAGE3K_MACOS_PG17_QA_ONLY");
if(!process.env.CARGO_TARGET_DIR || !existsSync(process.env.CARGO_TARGET_DIR))
 throw Error("STAGE3K_REQUIRES_EXISTING_CARGO_TARGET_DIR: no new large target");
const env={};
for(const k of ["HOME","PATH","TMPDIR","CARGO_HOME","RUSTUP_HOME","CARGO_TARGET_DIR","LANG","LC_ALL"])
 if(process.env[k])env[k]=process.env[k];
env.KATOSYNC_STAGE3K_FRESH_TEST_TIME="EPHEMERAL_ONLY";
const temp=mkdtempSync(join("/tmp","katosync-stage3k-"));
chmodSync(temp,0o700);
const temporaryResourceStubs=[];
const placeholderDist=join(root,"dist");
let createdDist=false;
function run(bin,args,vars){
 const result=spawnSync(bin,args,{cwd:root,env:vars,encoding:"utf8",
  timeout:180_000,maxBuffer:4*1024*1024});
 if(result.error||result.status!==0)
  throw Error("STAGE3K_LOCAL_COMMAND_FAILED:"+bin+" exit="+String(result.status)+
   " stderr="+(result.stderr??"").slice(-1300));
 return result.stdout;
}
try{
 // Test-only empty Tauri resource directories are required by build.rs.
 // Never package these, and remove only directories created by this run.
 for(const name of ["poppler","typst"]){
  const dir=join(root,"src-tauri","resources",name);
  if(!existsSync(dir)){mkdirSync(dir);temporaryResourceStubs.push(dir);}
 }
 if(!existsSync(placeholderDist)){
  mkdirSync(placeholderDist);
  writeFileSync(join(placeholderDist,"index.html"),"<!doctype html><title>QA only</title>");
  createdDist=true;
 }
 const out=run("cargo",["test","--offline","--manifest-path",
  join(root,"src-tauri","Cargo.toml"),"--features","katoos-auth-qa","--lib",
  "qa_emit_stage3j_edge_interop_fixture","--","--nocapture"],env);
 const markers=out.split("\n").filter(x=>x.includes("KATOSYNC_STAGE3J_RUST_FIXTURE="));
 if(markers.length!==1)throw Error("STAGE3K_NATIVE_SIGNATURE_FIXTURE_MISSING");
 const f=JSON.parse(markers[0].split("KATOSYNC_STAGE3J_RUST_FIXTURE=")[1]);
 if(f.generatedBy!=="rust-production-ed25519-dalek-serde"||f.fixtureOnly!==true||
    Math.abs(f.nowMs-Date.now())>30_000)
  throw Error("STAGE3K_EXPECTED_FRESH_SYNTHETIC_RUST_SIGNATURES");
 const serialized=JSON.stringify(f);
 if(/privateKey|secretKey|signingSeed|refresh_token|service_role|password/i.test(serialized))
  throw Error("STAGE3K_SECRET_FIELD_IN_FIXTURE");
 if(!f.challenge?.signature||!f.response?.signature||
    !f.listInitiator?.signature||!f.listRecipient?.signature)
  throw Error("STAGE3K_INCOMPLETE_PUBLIC_SIGNATURES");
 const fixture=join(temp,"rust-public.json");
 writeFileSync(fixture,serialized,{encoding:"utf8",mode:0o600});
 // PG runner installs only pinned staged schema into a fresh Unix-socket DB.
 // It owns the database lifecycle and deletes its temp cluster on exit.
 const sqlOut=run("bash",["scripts/qa-mesh-postgres-local.sh","inbox-relay-rust-e2e"],
  {...env,KATOSYNC_STAGE3K_RUST_FIXTURE:fixture});
 if(!sqlOut.includes("STAGE3K_RUST_EDGE_REAL_POSTGRES_PASS")||
    !sqlOut.includes("MESH_QA_ALL_SQL_ASSERTIONS_PASSED"))
  throw Error("STAGE3K_MISSING_SQL_EDGE_E2E_ASSERTIONS");
 console.log("STAGE3K_RUST_EDGE_REAL_POSTGRES_PASS: fresh Rust signed Challenge/Response/read proofs -> Edge handler -> real disposable PostgreSQL; no cloud, trust or device pairing");
}catch(e){
 console.error("STAGE3K_BLOCKED: "+String(e instanceof Error?e.message:e));
 process.exitCode=1;
}finally{
 rmSync(temp,{force:true,recursive:true});
 for(const dir of temporaryResourceStubs)rmdirSync(dir);
 if(createdDist){rmSync(join(placeholderDist,"index.html"));rmdirSync(placeholderDist);}
}
