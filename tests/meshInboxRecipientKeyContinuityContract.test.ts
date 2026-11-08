// NMKato Solutions — Stage 2S recipient proof key-continuity contract.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const file=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const migration=file("../supabase/migrations/20261030093323_mesh_inbox_recipient_key_continuity.sql");
const edge=file("../supabase/functions/mesh-inbox-receive/receive.ts");
const sql=file("sql/mesh_inbox_key_continuity_qa.sql");
const gate=file("../scripts/qa-mesh-inbox-rollout-gate.mjs");

test("record a single verified recipient public key per proof without exposing service grants",()=>{
 assert.match(migration,/ADD COLUMN signing_public_key text/);
 assert.match(migration,/mesh_inbox_proof_signing_key_required CHECK/);
 assert.match(migration,/NOT VALID/);
 assert.match(migration,/SECURITY INVOKER SET search_path=''/);
 assert.doesNotMatch(migration,/SECURITY DEFINER/);
 assert.match(migration,/FROM PUBLIC,anon,authenticated/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION/);
 assert.doesNotMatch(migration,/GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON katosync\.mesh_inbox_proofs TO authenticated/);
});

test("both proof creation and decision join the CURRENT recipient key, not an arbitrary source key",()=>{
 assert.match(migration,/d\.device_id=NEW\.device_id/);
 assert.match(migration,/d\.signing_public_key=NEW\.signing_public_key/);
 assert.match(migration,/p\.signing_public_key=d\.signing_public_key/);
 assert.match(migration,/p\.device_id=OLD\.target_device_id/);
 assert.match(migration,/p\.request_id=OLD\.request_id/);
 assert.match(migration,/FOR SHARE OF d/g);
 assert.match(migration,/d\.membership_state='discovered'/);
 assert.match(migration,/d\.revoked_at IS NULL/);
 assert.match(migration,/KATOSYNC_MESH_INBOX_RECIPIENT_KEY_CHANGED/);
});

test("Edge stores only registry-derived public key, verifies DB echo before processing inbox",()=>{
 assert.match(edge,/signing_public_key:device\.signing_public_key/);
 assert.match(edge,/saved\.signing_public_key!==device\.signing_public_key/);
 assert.match(edge,/INBOX_PROOF_UNCONFIRMED/);
 assert.match(edge,/resolution_proof_id:saved\.proof_id/);
 assert.doesNotMatch(edge,/paired:true|transportReady:true|remoteJobsEnabled:true/);
});

test("disposable real PostgreSQL suite covers rotated, wrong, missing and revoked key",()=>{
 for(const term of ["MESH_RECIPIENT_KEY_NULL_PROOF_ACCEPTED",
   "MESH_RECIPIENT_WRONG_KEY_PROOF_ACCEPTED",
   "MESH_RECIPIENT_OLD_KEY_DECISION_ACCEPTED",
   "MESH_RECIPIENT_REVOKED_DECISION_ACCEPTED",
   "MESH_RECIPIENT_VALID_PIN_NOT_ACCEPTED",
   "MESH_RECIPIENT_VALID_REJECT_FAILED"])
   assert.ok(sql.includes(term));
 assert.match(gate,/20261030093323/);
 assert.match(gate,/proofKeyResolutionTrigger/);
 assert.match(gate,/proofKeyInsertTrigger/);
});
