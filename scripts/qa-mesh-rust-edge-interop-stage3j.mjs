// NMKato Solutions — reproducible native Rust→WebCrypto→Edge QA, all local.
// Does not access user Keychain, live Supabase, network, Cloud or device Mesh.
import {spawnSync} from "node:child_process";
import {mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const manifest=join(root,"src-tauri","Cargo.toml");
const files=[
 join(root,"tests","meshRelayRustToEdgeInteropStage3J.test.ts"),
 join(root,"tests","meshRelayRustEdgeFullApiStage3J.test.ts"),
];
function run(bin,args,environment){
 const out=spawnSync(bin,args,{cwd:root,env:environment,
  encoding:"utf8",maxBuffer:4*1024*1024,timeout:150_000});
 if(out.error||out.status!==0){
  // Avoid leaking stdout that might accidentally include native system logs.
  process.stderr.write("STAGE3J_QA_COMMAND_FAILED: "+bin+" "+(out.error?.message??out.status)+"\n");
  process.stderr.write((out.stderr??"").slice(-1600)+"\n");
  process.exitCode=2;
  return null;
 }
 return out.stdout;
}
const env={...process.env};
delete env.KATOSYNC_MESH_INBOX_SEND_QA;
delete env.KATOSYNC_MESH_INBOX_RECEIVE_QA;
delete env.KATOSYNC_MESH_PAIRING_RELAY_QA;
delete env.KATOSYNC_STAGE3J_RUST_FIXTURE;
// The caller can set an existing reusable CARGO_TARGET_DIR, avoiding disk-heavy
// new compilations on the constrained M2. No implicit resource cleanup.
const temporary=mkdtempSync(join(tmpdir(),"katosync-mesh-stage3j-"));
chmodSync(temporary,0o700);
try{
 const output=run("cargo",["test","--offline","--manifest-path",manifest,
  "--features","katoos-auth-qa","--lib","qa_emit_stage3j_edge_interop_fixture",
  "--","--nocapture"],env);
 if(output===null)process.exit(2);
 const lines=output.split("\n").filter(line=>line.includes("KATOSYNC_STAGE3J_RUST_FIXTURE="));
 if(lines.length!==1)throw Error("RUST_FIXTURE_COUNT_NOT_ONE");
 const obj=JSON.parse(lines[0].split("KATOSYNC_STAGE3J_RUST_FIXTURE=")[1]);
 if(obj.generatedBy!=="rust-production-ed25519-dalek-serde"||obj.fixtureOnly!==true)
  throw Error("UNEXPECTED_RUST_FIXTURE");
 const serialized=JSON.stringify(obj);
 if(/privateKey|secretKey|signingSeed|refresh_token|service_role|password/i.test(serialized))
  throw Error("RUST_FIXTURE_CONTAINS_SECRET");
 const input=join(temporary,"signed-public-fixture.json");
 writeFileSync(input,serialized,{encoding:"utf8",mode:0o600});
 const generated=JSON.parse(readFileSync(input,"utf8"));
 if(!generated.challenge?.signature||!generated.response?.signature||
    !generated.listInitiator?.signature||!generated.listRecipient?.signature)
  throw Error("INCOMPLETE_RUST_SIGNATURES");
 const nodeOutput=run(process.execPath,["--experimental-strip-types","--test",...files],
  {...env,KATOSYNC_STAGE3J_RUST_FIXTURE:input});
 if(nodeOutput===null)process.exit(3);
 if(!/# pass 7\b/.test(nodeOutput)||!/# fail 0\b/.test(nodeOutput))
  throw Error("RUST_EDGE_ASSERTIONS_MISSING");
 process.stdout.write("STAGE3J_RUST_SIGNED_INTEROP_PASS: freshly generated Rust/Serde "+
  "Challenge+Response+signed-read proofs validated by WebCrypto/Edge, 7/7 QA tests\n");
}catch(e){
 process.stderr.write("STAGE3J_QA_FAILED: "+String(e instanceof Error?e.message:e)+"\n");
 process.exitCode=1;
}finally{
 rmSync(temporary,{recursive:true,force:true});
}
