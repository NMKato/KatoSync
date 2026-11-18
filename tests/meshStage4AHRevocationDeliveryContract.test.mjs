// NMKato Solutions — Stage4AH, non-deploy native revocation QA contracts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa/execution_fence_qa.rs", import.meta.url), "utf8");
const revoke = readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa/execution_fence_qa/revoke_delivery_qa.rs", import.meta.url), "utf8");
const prefix = src.slice(0, src.indexOf("#[cfg(test)]"));
test("Stage4AH revocation acceptance stays strictly inside native cfg(test)", () => {
  assert.match(src, /#\[cfg\(test\)\]\s*#\[path = "execution_fence_qa\/revoke_delivery_qa\.rs"\]\s*mod revoke_delivery_qa;/);
  assert.doesNotMatch(prefix, /QaSignedRevokeNotice|QaLocalRevocationGate|pub fn|Command::new|tauri::command|TcpListener/);
  assert.doesNotMatch(revoke, /tauri::command|TcpListener|TcpStream|supabase::|reqwest::|git push|git reset/);
});
test("signed delivery needs pinned permit issuer AND pinned server key", () => {
  assert.match(revoke, /pinned_permit_issuer\s*\.verify\(/);
  assert.match(revoke, /pinned_control_plane\s*\.verify\(/);
  assert.match(revoke, /KatoSync-Stage4AH-private-revoke-QA-v1/);
  for (const field of ["owner_id","tenant_id","owner_session_id","client_id","local_device_key","peer_device_key","project_id","task_id","sequence","event_id"]) {
    assert.ok(revoke.includes(field), field);
  }
});
test("revocation is sticky, monotonic and accepted without a live Mesh socket", () => {
  assert.match(src, /fn apply_signed_server_revocation\(/);
  assert.match(src, /sequence <= state\.last_server_sequence/);
  assert.match(src, /state\.revoked = true/);
  assert.ok(revoke.includes("A revoke is accepted even if the Mesh socket is offline"));
});
test("in-flight test child is killed and reaped on revoked lease or timeout", () => {
  assert.match(src, /fn qa_wait_with_revocation\(/);
  assert.match(src, /child\.kill\(\)/);
  assert.match(src, /child\.wait\(\)/);
  assert.match(src, /qa_wait_with_revocation\(child, local_revoke, generation\)/);
  assert.match(revoke, /fn in_flight_local_test_child_is_killed_after_verified_signed_revoke\(/);
});
test("negative native tests cover signer, scope, expiry, tamper and replay", () => {
  for (const name of [
    "forged_control_plane_signature_and_unpinned_key_are_rejected",
    "wrong_owner_session_project_task_and_device_are_rejected",
    "expired_future_and_malformed_events_cannot_assert_server_authority",
    "tampered_original_job_signature_never_becomes_a_revoke_authority",
    "replayed_signed_delivery_is_denied_and_local_revoke_stays_sticky",
  ]) assert.ok(revoke.includes(name), name);
});
