// NMKato Solutions — immutable hardware QA gate, no network in Node suite.
import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const path=fileURLToPath(new URL("../scripts/qa-mesh-two-mac-synthetic.sh",import.meta.url));
const script=readFileSync(path,"utf8");
const source=readFileSync(new URL("../src-tauri/src/mesh_transport.rs",import.meta.url),"utf8");
const tls=readFileSync(new URL("../src-tauri/src/mesh_tls.rs",import.meta.url),"utf8");
const run=(env:Record<string,string>)=>spawnSync("bash",[path],{
  env:{PATH:process.env.PATH??"/usr/bin:/bin",...env},encoding:"utf8",timeout:3000
});
test("hardware LAN launcher refuses all implicit launches before any cargo or socket",()=>{
 const blocked=run({});
 assert.equal(blocked.status,2);
 assert.match(blocked.stderr,/MESH_LAN_QA_BLOCKED/);
 assert.doesNotMatch(blocked.stdout,/Compiling|Running|MESH_LAN_QA_SYNTHETIC_ONLY/);
});
test("explicit synthetic allow requires recognized role and both endpoint IP fields",()=>{
 const base={KATOSYNC_MESH_LAN_QA_ALLOW:"SYNTHETIC_FIXTURES_ONLY"};
 const wrong=run({...base,KATOSYNC_MESH_LAN_QA_ROLE:"auto"});
 assert.equal(wrong.status,2);
 const missing=run({...base,KATOSYNC_MESH_LAN_QA_ROLE:"server"});
 assert.equal(missing.status,2);
 assert.match(missing.stderr,/peer required/);
});
test("negative server expectations cannot be silently set from other roles",()=>{
 const base={KATOSYNC_MESH_LAN_QA_ALLOW:"SYNTHETIC_FIXTURES_ONLY",
   KATOSYNC_MESH_LAN_QA_ADDRESS:"192.168.1.10:49328",
   KATOSYNC_MESH_LAN_QA_EXPECT_PEER:"192.168.1.20",
   KATOSYNC_MESH_LAN_QA_ROLE:"client",KATOSYNC_MESH_LAN_QA_NEGATIVE:"YES"};
 assert.equal(run(base).status,2);
});
test("only synthetic fixture keys and explicitly ignored one-shot test are used",()=>{
 assert.match(script,/SYNTHETIC_FIXTURES_ONLY/);
 assert.match(script,/-- --ignored --exact --nocapture/);
 assert.match(source,/SigningKey::from_bytes\(&\[seed; 32\]\)/);
 assert.match(source,/let a = signing\(41\)/);
 assert.match(source,/let b = signing\(42\)/);
 assert.match(source,/let outsider = signing\(43\)/);
 assert.match(source,/#\[ignore = "manual two-machine LAN QA/);
 assert.match(source,/TcpListener::bind\(address\)/);
 assert.match(source,/Duration::from_secs\(45\)/);
 assert.match(tls,/TLSv1_3|TLS13|TLS_13|TLS13/);
});
