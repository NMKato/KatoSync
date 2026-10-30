// NMKato Solutions — Stage 2O.1 defense in depth against fabricated resolution.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
const migration=read("../supabase/migrations/20261030074910_mesh_resolution_proof_binding.sql");
const receive=read("../supabase/functions/mesh-inbox-receive/receive.ts");
const postgreSQL=read("../tests/sql/mesh_resolution_proof_qa.sql");
test("recipient decision requires a server-registered device-attested proof",()=>{
 for(const required of [
  /resolution_proof_id uuid/,
  /REFERENCES katosync\.mesh_inbox_proofs\(proof_id\)/,
  /mesh_invite_resolution_proof_unique/,
  /p\.owner_user_id=OLD\.owner_user_id/,
  /p\.device_id=OLD\.target_device_id/,
  /p\.request_id=OLD\.request_id/,
  /p\.action=CASE NEW\.state/,
  /p\.expires_at>pg_catalog\.now\(\)/,
  /OLD\.resolution_proof_id IS NOT NULL/,
 ])assert.match(migration,required);
 assert.doesNotMatch(migration,/SECURITY DEFINER/);
});
test("source signing key rotation blocks any already queued invite decision",()=>{
 assert.match(migration,/d\.signing_public_key=OLD\.signed_offer->>'publicKey'/);
 assert.match(migration,/d\.revoked_at IS NULL/);
 assert.match(postgreSQL,/MESH_PROOF_SOURCE_ROTATION_ACCEPTED/);
 assert.match(postgreSQL,/MESH_PROOF_WRONG_ACTION_ACCEPTED/);
 assert.match(postgreSQL,/MESH_PROOF_WRONG_REQUEST_ACCEPTED/);
});
test("Edge never reads a client proof ID and refuses forged storage receipts",()=>{
 assert.match(receive,/Prefer:"return=representation"/);
 assert.match(receive,/INBOX_PROOF_UNCONFIRMED/);
 assert.match(receive,/resolution_proof_id:saved\.proof_id/);
 assert.match(receive,/saved\.owner_user_id!==owner/);
 assert.match(receive,/saved\.device_id!==proof\.deviceId/);
 assert.match(receive,/saved\.action!==proof\.action/);
 assert.match(receive,/saved\.request_id!==proof\.requestId/);
 assert.match(receive,/proof\.expiresAt\*1000<=Date\.now\(\)/);
 assert.doesNotMatch(receive,/paired:true|transportReady:true|remoteJobsEnabled:true/);
});
