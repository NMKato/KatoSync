// KatoSync Stage4E — static proof that the real-PG17 localstack QA
// can only run as a disposable Unix-socket test, never a Cloud deployment.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const get=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const sql=get("scripts/qa-mesh-postgres-local.sh");
const stack=get("tests/qa/meshInboxOwnerLocalStackStage4E.mjs");
const ci=get(".github/workflows/pr-fast-gate.yml");

test("real-DB harness is local only and requires disposable socket admission",()=>{
 for(const s of ["KATOSYNC_INBOX_LOCAL_STACK_QA_ONLY",
  "EPHEMERAL_LOOPBACK_PG17","ksmeshqa","statSync(real).mode&0o777,0o700",
  "server.listen(0,\"127.0.0.1\"","assert.equal(url.origin,ORIGIN",
  "server.close","KATOSYNC_STAGE4E_LOCALSTACK_AUTH_EDGE_SQL_PASS_NO_REMOTE"])
  assert.ok(stack.includes(s),s);
 for(const s of ["inbox-lifecycle-localstack) TEST_FILE",
  "listen_addresses=''","MESH_QA_UNEXPECTED_TCP_LISTENER",
  "KATOSYNC_INBOX_LOCAL_STACK_QA_ONLY=EPHEMERAL_LOOPBACK_PG17",
  "node --experimental-strip-types",
  "trap cleanup EXIT INT TERM"])
  assert.ok(sql.includes(s),s);
 assert.doesNotMatch(stack,/https:\/\/xbnnlyyxiilklsygxcof|supabase db push|supabase functions deploy|postgresql:\/\//);
});
test("the synthetic signed user is actually verified, not just decoded",()=>{
 for(const s of ["generateKeyPairSync(\"ec\"","alg:\"ES256\"",
  "dsaEncoding:\"ieee-p1363\"","sessions.has(p.session_id)",
  "verify(\"sha256\"","p.exp<=Math.floor(Date.now()/1000)",
  "sessions.delete(revoked.sid)","LOCALSTACK_ES256_INVALID_EXPIRED_SIGNED_OUT_DENIED"])
  assert.ok(stack.includes(s),s);
 assert.doesNotMatch(stack,/\bHS256\b|raw_user_meta_data/);
});
test("real actor maps through actual owner handler to row-locked SQL and one audit",()=>{
 for(const s of ["handleInboxTerminalOwnerQA",
  "/auth/v1/user","/rest/v1/account_memberships",
  "/rest/v1/rpc/mesh_inbox_terminal_close_qa","SET ROLE service_role",
  "LOCALSTACK_FOREIGN_AUTHENTICATED_OWNER_DENIED",
  "LOCALSTACK_REAL_POSTGRES_17_ATOMIC_CANCEL_FREE0",
  "LOCALSTACK_IDEMPOTENT_ONE_AUDIT",
  "LOCALSTACK_LATE_ACCEPT_DENIED_NO_REOPEN"])
  assert.ok(stack.includes(s),s);
 assert.match(stack,/assert\.equal\(audits\(pending\),1\)/);
 assert.match(stack,/assert\.equal\(state\(pending\),"cancelled"\)/);
});
test("standalone test cannot open a socket without the exact local proof",()=>{
 const path=fileURLToPath(new URL("../tests/qa/meshInboxOwnerLocalStackStage4E.mjs",import.meta.url));
 const p=spawnSync(process.execPath,["--experimental-strip-types",path],{
  env:{...process.env,KATOSYNC_INBOX_LOCAL_STACK_QA_ONLY:"",
   KATOSYNC_MESH_E2E_SOCKET:"",KATOSYNC_MESH_E2E_PORT:""},
  encoding:"utf8",timeout:5000});
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/KATOSYNC_LOCAL_STACK_REQUIRES_DISPOSABLE_UNIX_SOCKET/);
});
test("CI integration container has no outbound network or writeable repository",()=>{
 const docker=get("tests/qa/pg17-node22-localstack.Dockerfile");
 assert.match(docker,/FROM postgres:17-alpine3\.22/);
 assert.match(docker,/RUN apk add --no-cache bash nodejs/);
 assert.match(docker,/USER postgres/);
 assert.match(ci,/--network none --read-only/);
 assert.match(ci,/--cap-drop ALL --security-opt no-new-privileges/);
 assert.match(ci,/readonly/);
 assert.match(ci,/inbox-lifecycle-localstack/);
 assert.doesNotMatch(docker,/EXPOSE|COPY.*\.env|SUPABASE_SERVICE_ROLE_KEY/);
 assert.equal(readdirSync(new URL("../supabase/migrations/",import.meta.url))
  .filter(p=>p.endsWith(".sql")).length,7);
});
