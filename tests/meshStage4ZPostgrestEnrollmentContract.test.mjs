import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../src-tauri/src/mesh_enrollment_gate.rs",import.meta.url),"utf8");

test("owner-scoped PostgREST selection and strict Rust deserializer use same field spelling",()=>{
 assert.match(source,/select", "owner_user_id,signing_public_key,fingerprint,membership_state,enrolled_at,revoked_at"/);
 assert.match(source,/\#\[serde\(deny_unknown_fields\)\]\s*struct EnrollmentRecord/);
 assert.doesNotMatch(source,/\#\[serde\(rename_all = "camelCase", deny_unknown_fields\)\]\s*struct EnrollmentRecord/);
});

test("native regression decodes snake_case and continues to reject unknown records",()=>{
 assert.match(source,/fn postgrest_snake_case_roster_decodes_without_weakening_validation\(/);
 assert.match(source,/serde_json::from_value\(json.clone\(\)\)/);
 assert.match(source,/tampered\[0\]\["unexpected_field"\]/);
 assert.match(source,/serde_json::from_value::<Vec<EnrollmentRecord>>\(tampered\)\.is_err\(\)/);
});
