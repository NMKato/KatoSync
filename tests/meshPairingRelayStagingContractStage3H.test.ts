// NMKato Solutions – Stage3H staging gates, no production deployment.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const load=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const edge=load("../supabase/functions/mesh-pairing-relay/relay.ts");
const entry=load("../supabase/functions/mesh-pairing-relay/index.ts");
const originGate=load("../supabase/functions/mesh-pairing-relay/origin-gate.ts");
const sql=load("../supabase/migrations/20261031213900_mesh_pairing_relay_staged.sql");
const runner=load("../scripts/qa-mesh-postgres-local.sh");
const fixture=load("sql/mesh_pairing_relay_qa.sql");
const inboxRollout=load("../scripts/qa-mesh-inbox-rollout-gate.mjs");
test("relay requires exact QA stage, verified tenant origin and active membership",()=>{
 assert.match(edge,/KATOSYNC_MESH_PAIRING_RELAY_STAGE!=="qa-relay"/);
 assert.match(edge,/resolveMeshRelayOrigin\(e\)/);
 assert.match(originGate,/MESH_LIVE_ORIGIN/);
 assert.match(originGate,/isolated-preview-only/);
 assert.match(edge,/\/auth\/v1\/user/);
 assert.match(edge,/requireMeshRelayMembership\(owner,service\(e\),request,origin\)/);
 assert.match(edge,/verifyRelayEnvelope\(msg,owner/);
 assert.match(edge,/verifyRelayListProof\(proof,owner/);
 assert.match(edge,/RELAY_ALREADY_SENT/);
 assert.match(edge,/PROOF_ALREADY_USED/);
 assert.match(edge,/RELAY_INVALID_SIGNATURE/);
 assert.match(entry,/Deno\.env\.get\("KATOSYNC_MESH_PAIRING_RELAY_STAGE"\)/);
});
test("relay SQL keeps service-role-only writes, RLS, atomic accepted-invite and one-use gates",()=>{
 for(const needle of [
  "CREATE TABLE katosync.mesh_pairing_relay_messages",
  "CREATE TABLE katosync.mesh_pairing_relay_reads",
  "ENABLE ROW LEVEL SECURITY",
  "REVOKE ALL ON katosync.mesh_pairing_relay_messages FROM PUBLIC,anon,authenticated",
  "REVOKE ALL ON katosync.mesh_pairing_relay_reads FROM PUBLIC,anon,authenticated",
  "GRANT SELECT,INSERT ON katosync.mesh_pairing_relay_messages TO service_role",
  "GRANT SELECT,INSERT ON katosync.mesh_pairing_relay_reads TO service_role",
  "mesh_relay_single_step UNIQUE(owner_user_id,request_id,kind)",
  "mesh_relay_nonce_unique UNIQUE(owner_user_id,sender_device_id,nonce)",
  "mesh_relay_read_nonce UNIQUE(owner_user_id,device_id,nonce)",
  "mesh_pairing_relay_insert_guard",
  "mesh_relay_read_rate_guard",
  "invite.state <> 'accepted'",
  "prior.kind='challenge'",
  "revoked_at IS NULL"
 ]) assert.ok(sql.includes(needle),needle);
 assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE) ON katosync\.mesh_pairing_relay_\w+ TO authenticated/i);
});
test("relay cannot silently grant trust, TLS transport or remote execution",()=>{
 assert.match(edge,/remoteJobsEnabled:false/);
 for(const source of [edge,entry]){
  assert.doesNotMatch(source,/mesh_local_approve_peer|remote_task_execute|TcpListener|set_password|Keychain/);
  assert.doesNotMatch(source,/remoteJobsEnabled:true|transportReady:true|paired:true/);
 }
});
test("offline SQL QA uses ephemeral unix socket and is deliberately outside four Inbox production gates",()=>{
 assert.match(runner,/inbox-relay\) TEST_FILE="\$ROOT\/tests\/sql\/mesh_pairing_relay_qa\.sql"/);
 assert.match(runner,/listen_addresses=''/);
 assert.match(runner,/mktemp -d \/tmp\/ksmeshqa/);
 assert.match(fixture,/MESH_RELAY_LOCAL_SQL_SECURITY_PASS/);
 assert.match(fixture,/RELAY_RESPONSE_WITHOUT_CHALLENGE_OPEN/);
 assert.match(fixture,/RELAY_CLIENT_ACCESS_OPEN/);
 assert.match(fixture,/RELAY_REPLAY_NONCE_ALLOWED/);
 assert.doesNotMatch(inboxRollout,/20261031213900_mesh_pairing_relay_staged/);
});
