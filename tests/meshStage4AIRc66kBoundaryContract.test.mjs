// NMKato Solutions — Stage4AI source-only contract checks, no device access.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const rel = "../src-tauri/src/mesh_durable_lease_qa/signed_job_qa/execution_fence_qa";
const parent = readFileSync(new URL(rel + ".rs", import.meta.url), "utf8");
const wire = readFileSync(new URL(rel + "/rc66k_boundary_qa.rs", import.meta.url), "utf8");
const revoke = readFileSync(new URL(rel + "/revoke_delivery_qa.rs", import.meta.url), "utf8");
const durable = readFileSync(new URL(rel + "/revoke_delivery_qa/durable_qa.rs", import.meta.url), "utf8");
const prefix = parent.slice(0, parent.indexOf("#[cfg(test)]"));

test("Stage4AI native RC66K and durable state remain hidden behind cfg(test)",()=>{
  assert.match(parent, /#\[cfg\(test\)\]\s*#\[path = "execution_fence_qa\/rc66k_boundary_qa\.rs"\]\s*mod rc66k_boundary_qa;/);
  assert.match(revoke, /#\[cfg\(test\)\]\s*#\[path = "revoke_delivery_qa\/durable_qa\.rs"\]\s*mod durable_qa;/);
  assert.doesNotMatch(prefix, /rc66k_boundary_qa|QaDurableRevocationJournal|std::process::Command|tauri::command/);
});
test("strict RC66K EdDSA JWS header plus pinned-key, hash and exact body",()=>{
  for(const marker of ["RC66K_CONTROL_PLANE_QA_ACK","katosync-rc66k-qa-invalidate-ack+jws",
    "URL_SAFE_NO_PAD","Sha256::digest","pinned_server_key",
    'vstr(&header, "alg")?', 'vstr(&header, "kid")?',
    "claim.leased_until_ms <= now_ms","controlPlaneInvalidated","receivingSystem",
    "consentId","deviceId","auditId","leaseToken","grantId","workerId",
    "payload != envelope.payload_text.as_bytes()"]){
     assert.ok(wire.includes(marker),marker);
  }
});
test("a verified RC66K control-plane ACK is never a device revoke authorization",()=>{
  const block = wire.split("struct VerifiedControlPlaneAck {")[1]?.split("\n}")[0];
  assert.ok(block);
  assert.match(block, /audit_id/);
  assert.match(block, /grant_id/);
  assert.doesNotMatch(block.split("\n").filter(x=>!x.trim().startsWith("//")).join("\n"), /task_id|owner_session_id|execut|device_delivered|deviceAccessEnabled/);
  assert.ok(wire.includes("CONTROL-PLANE QA ACK, NOT DEVICE DELIVERY"));
});
test("startup state remains closed on absent, corrupt and symlink markers",()=>{
  assert.match(durable, /ClosedPendingAuthoritativeReconciliation/);
  assert.match(durable, /RevokedOrPoisoned/);
  assert.match(durable, /symlink_metadata/);
  assert.match(durable, /create_new\(true\)/);
  assert.match(durable, /sync_all\(\)/);
  assert.match(durable, /fn signed_revocation_persists_across_reopen_and_never_rearms/);
  assert.match(durable, /fn torn_marker_and_symlinked_marker_both_keep_restart_closed/);
  assert.match(durable, /fn restore_gate_fail_closed\(/);
});
test("permanence depends on independently pinned synthetic notice—not unsigned ACK",()=>{
  assert.match(durable, /accept_pinned_signed_revoke\(/);
  assert.match(durable, /pinned_permit_issuer/);
  assert.match(durable, /pinned_control_plane/);
  assert.match(durable, /fn unsigned_or_wrongly_signed_revoke_never_creates_durable_marker/);
});
test("no production network transport, Git mutation or public device interface",()=>{
  for (const file of [wire,durable]) {
    assert.doesNotMatch(file,/reqwest::|TcpListener|TcpStream|tauri::command|std::process::Command|git push|git reset|eval\(/);
  }
  assert.match(parent, /qa_wait_with_revocation/);
});
