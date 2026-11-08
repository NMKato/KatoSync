// QA-only migration safety; never runs SQL or accesses Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readdirSync,readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
const root=fileURLToPath(new URL("..",import.meta.url));
const live=["20261028202403_katosync_mesh_owned_schema.sql", "20261028202503_katosync_add_to_existing_exposed_schemas.sql", "20261028204216_katosync_account_membership_admission.sql", "20261104222611_katosync_feature_approver_authority_gate5.sql", "20261104222901_katosync_feature_approver_activation_fix_gate5.sql", "20261105084427_katosync_feature_owner_one_time_challenge_gate7.sql", "20261105100122_katosync_reviewer_signed_attestation_gate9.sql"];
const fixtures={
  "20261029211243_mesh_inbox_signed_send_guard.sql": "0d52bf08fe93e32e53b3e284d6a0bfd8db68d38d475a44479fa082ad61225124",
  "20261030072543_mesh_recipient_signed_inbox_atomic_decisions.sql": "ca57d61435f7f3620ec2f311d93a188210ef12d25ac7a520f74b781ac634197e",
  "20261030074910_mesh_resolution_proof_binding.sql": "cd1b2e9c1e52b28e7012f4cccaf5ce193c5f6e317ee190e28e272d4d5bab8281",
  "20261030093323_mesh_inbox_recipient_key_continuity.sql": "358beec0cab70d43065428a4627d2888b22b9f85c5e858fdb32e01c322cbf361",
  "20261031213900_mesh_pairing_relay_staged.sql": "7b834ad933c94623045c04f4b79d33ed36306b55f3a94a218bf8f811b9d1eb72",
  "20261103162300_mesh_one_time_trial_claims.sql": "94c4e206f95005649c4745cec25a6aec2f69ad59eadaf1d96bae8137972ebb1b",
  "20261103162500_mesh_entitlement_expiry_guard.sql": "44111b4eb7feb3bef726caca49eef151b2d30b9af4eeeccd9532f8c23e356069",
  "20261103164548_katosync_billing_product_scoped.sql": "940375a79f5a03ff5d723ccf6f3fc092b05bc75ad77d7185d1a1969efc218a6a"
};
test("normal Supabase migrations directory contains only seven installed versions",()=>{
 const files=readdirSync(join(root,"supabase/migrations")).filter(x=>x.endsWith(".sql")).sort();
 assert.deepEqual(files,live);
});
test("eight historical/NOT APPLIED SQL files are immutable QA fixtures",()=>{
 const names=readdirSync(join(root,"tests/fixtures/migrations")).filter(x=>x.endsWith(".sql")).sort();
 assert.deepEqual(names,Object.keys(fixtures).sort());
 for(const [name,expected] of Object.entries(fixtures)){
  const actual=createHash("sha256").update(readFileSync(join(root,"tests/fixtures/migrations",name))).digest("hex");
  assert.equal(actual,expected,"QA fixture changed: "+name);
 }
});
test("migration reconciliation and release gate are review-only; no workflow applies SQL",()=>{
 const doc=readFileSync(join(root,"docs/KATOSYNC_LIVE_MIGRATION_RECONCILIATION_2026-11-08.md"),"utf8");
 assert.match(doc,/NEVER APPLY/i);
 assert.match(doc,/independent signed reviewer/i);
 for(const file of readdirSync(join(root,".github/workflows")).filter(x=>x.endsWith(".yml"))){
  const workflow=readFileSync(join(root,".github/workflows",file),"utf8");
  assert.doesNotMatch(workflow,/\bsupabase\s+(?:db\s+push|migration\s+up|db\s+reset)\b/i);
 }
});
