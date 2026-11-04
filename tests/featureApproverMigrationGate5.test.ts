import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(n:string)=>readFileSync(new URL("../supabase/migrations/"+n,import.meta.url),"utf8");
const initial=read("20261104222611_katosync_feature_approver_authority_gate5.sql");
const fix=read("20261104222901_katosync_feature_approver_activation_fix_gate5.sql");
test("Gate 5 roles, project registry and audit stay server-only (no client self-grant)",()=>{
 for(const table of ["feature_approval_projects","feature_approver_grants","feature_approver_audit"]){
  assert.match(initial,new RegExp("CREATE TABLE katosync\\."+table+"\\s*\\("));
  assert.match(initial,new RegExp("ALTER TABLE katosync\\."+table+" ENABLE ROW LEVEL SECURITY"));
  assert.match(initial,new RegExp("REVOKE ALL ON katosync\\."+table+" FROM PUBLIC, anon, authenticated"));
  assert.doesNotMatch(initial,new RegExp("GRANT (?:SELECT|INSERT|UPDATE|DELETE).*\\b"+table+" TO authenticated"));
  assert.doesNotMatch(initial,new RegExp("CREATE POLICY \\S+ ON katosync\\."+table));
 }
 assert.match(initial,/UNIQUE\(project_id,subject_uid,grant_revision\)/);
 assert.match(initial,/WHERE state='active'/);
 assert.match(initial,/owner_signing_public_key/);
 assert.match(initial,/feature_approver_audit_no_update_delete/);
 assert.match(initial,/feature_approver_after_insert_update/);
});
test("grant activation is one-way, keys immutable, revocation cannot be undone",()=>{
 assert.match(fix,/OLD.state='pending' AND NEW.state='active'/);
 assert.match(fix,/OLD.authorized_at IS NULL AND NEW.authorized_at IS NOT NULL/);
 assert.match(fix,/OLD.state='revoked'/);
 assert.match(fix,/NEW.owner_signing_public_key IS DISTINCT FROM OLD.owner_signing_public_key/);
 assert.match(fix,/FEATURE_APPROVER_DELETE_FORBIDDEN/);
 assert.match(fix,/FEATURE_APPROVAL_PROJECT_DELETE_FORBIDDEN/);
 assert.match(fix,/feature_approval_project_no_delete_or_reactivate/);
 assert.doesNotMatch(fix,/SECURITY DEFINER/);
});
