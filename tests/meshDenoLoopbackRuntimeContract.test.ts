// NMKato Solutions — Stage 3B: Windows-compatible static/default-deny tests.
// Real Deno QA is manually invoked only on an isolated authorized Mac.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const script=fileURLToPath(new URL("../scripts/qa-mesh-deno-loopback.mjs",import.meta.url));
const src=readFileSync(script,"utf8");
test("deno real loopback QA is denied without explicit local binary opt-in",()=>{
 for(const args of [[],["--synthetic-loopback"],["--deploy"],["--synthetic-loopback","--deno-bin","https://example.invalid/deno"]]){
  const r=spawnSync(process.execPath,[script,...args],{encoding:"utf8",timeout:3000});
  assert.equal(r.status,2,r.stderr);
  assert.match(r.stderr,/MESH_DENO_LOOPBACK_BLOCKED: EXPLICIT_LOCAL_DENO_REQUIRED/);
 }
});
test("real Deno is loopback-only and denies outbound network + unnecessary capabilities",()=>{
 assert.match(src,/hostname:"127\.0\.0\.1"/);
 assert.match(src,/--allow-net=127\.0\.0\.1:/);
 assert.match(src,/--allow-env=/);
 assert.match(src,/--no-prompt/);
 assert.match(src,/--no-remote/);
 assert.match(src,/mkdtemp\(/);
 assert.match(src,/rm\(tmp,\{recursive:true,force:true\}\)/);
 assert.doesNotMatch(src,/--allow-all|--allow-run|--allow-ffi|--allow-read|--allow-write|0\.0\.0\.0/);
 assert.doesNotMatch(src,/supabase (db push|functions deploy|backups restore)/);
});
test("actual production Edge entrypoints are built with exact pinned SHA guard",()=>{
 assert.match(src,/buildReview\(ROOT\)/);
 assert.match(src,/REVIEW_ONLY_NO_DEPLOYMENT/);
 assert.match(src,/entryPoints:\[join\(ROOT,"supabase\/functions",name,"index\.ts"\)\]/);
 assert.match(src,/source\.split\(start\)\.length!==2/);
 assert.match(src,/source\.replace\(start/);
 assert.match(src,/Deno\.serve\(/);
});
test("all eight scenarios force fail-closed real HTTP statuses without live keys",()=>{
 assert.match(src,/for\(const kind of cases\)/);
 for(const word of ["off","wrong-stage","missing-secret","enabled-with-synthetic-only",
  "INBOX_NOT_CONFIGURED","METHOD_NOT_ALLOWED","LOGIN_REQUIRED","BAD_INVITE","BAD_PROOF"])
  assert.ok(src.includes(word),"missing "+word);
 assert.match(src,/SYNTHETIC-QA-PUBLIC-NOT-A-KEY/);
 assert.match(src,/SYNTHETIC-QA-SERVER-NOT-A-KEY/);
 assert.match(src,/realSupabaseEdgeGateway:false/);
 assert.match(src,/realJwtVerified:false/);
 assert.match(src,/authorizedToDeploy:false/);
 assert.match(src,/trustEnabled:false/);
 assert.match(src,/remoteJobsEnabled:false/);
});
