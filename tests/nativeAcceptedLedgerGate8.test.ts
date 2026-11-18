// KatoSync 4.0 Gate 8 – release boundary contract.
// This is supplemental to the authoritative Rust SQLite integration tests.
import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
 verifyFeatureAcceptanceLedger40,
 type AcceptanceAuthority40,
 type AcceptanceScope40,
} from "../src/lib/featureAcceptanceLedger40.ts";

const source=(relative:string)=>readFileSync(new URL("../"+relative,import.meta.url),"utf8");
const sql=source("src-tauri/src/memory_fabric/acceptance_ledger/verified_ledger.rs");
const auth=source("src-tauri/src/memory_fabric/acceptance_ledger/external_checks.rs");
const store=source("src-tauri/src/memory_fabric/store.rs");
const overview=source("src-tauri/src/memory_fabric/overview.rs");
const progress=source("src-tauri/src/memory_fabric/mvp_progress.rs");

test("Gate 8 SQLite verified receipts are a different immutable table from pending entries",()=>{
 assert.match(sql,/CREATE TABLE IF NOT EXISTS acceptance_verified_receipts/);
 assert.match(sql,/pending_receipt_hash TEXT NOT NULL UNIQUE REFERENCES acceptance_pending_receipts\(receipt_hash\)/);
 assert.match(sql,/CREATE TRIGGER IF NOT EXISTS acceptance_verified_no_update/);
 assert.match(sql,/CREATE TRIGGER IF NOT EXISTS acceptance_verified_no_delete/);
 assert.match(sql,/CHECK\(verified_percent=\(100\*accepted_weight\/total_weight\)\)/);
 assert.match(sql,/CHECK\(accepted_weight<=total_weight\)/);
 assert.match(sql,/verified_ci_jobs INTEGER NOT NULL/);
 assert.match(sql,/previous_verified_hash/);
 assert.match(sql,/acceptance_verified_project_chain/);
 assert.match(sql,/qa_verified_ledger_not_production_release/);
});
test("Gate 8 migration explicitly upgrades existing v5 without breaking readonly compatibility",()=>{
 assert.match(store,/SCHEMA_USER_VERSION: i64 = 6/);
 assert.match(store,/5 => \{/);
 assert.match(store,/BEGIN IMMEDIATE;\{verified_sql\}PRAGMA user_version=6;COMMIT;/);
 assert.match(overview,/&& version != 5/);
 assert.match(sql,/v5_to_v6_adds_verified_ledger_without_erasing_existing_project/);
});
test("only private native online KATOOS, issuer, owner, CI and Git corroboration calls QA writer",()=>{
 assert.match(auth,/accept_latest_pending_via_qa_issuer\(/);
 assert.match(auth,/corroborate_latest_pending_via_qa_issuer\(/);
 assert.match(auth,/same_account_still_verified/);
 assert.match(auth,/check_git\(registered_root, expected_repo, &receipt\.head_sha, None\)/);
 assert.match(auth,/append_qa_verified_acceptance\(/);
 assert.match(sql,/cfg!\(feature\s*=\s*"katoos-auth-qa"\)/);
 assert.match(sql,/ACCEPTANCE_QA_ONLY/);
 assert.doesNotMatch(progress,/acceptance_verified_receipts/);
 assert.match(progress,/verified_percent: None/);
});
test("without independently verified snapshots, the pure progress ledger remains unavailable",async()=>{
 const scope:AcceptanceScope40={
  projectId:"katosync",
  planJournalSequence:8,
  tasks:[{
   featureId:"feat-a",lane:"mvp",weight:3,
   acceptanceCriteria:"Independent signoff",ciChecks:[{workflow:"CI",job:"test"}]
  }]
 };
 const authority:AcceptanceAuthority40={
  verifyOwnerSignature:async()=>false,
  verifyCi:async()=>false,
  verifyDescendant:async()=>false,
 };
 const result=await verifyFeatureAcceptanceLedger40({
  scope,currentHeadSha:"a".repeat(40),
  snapshots:[],authority,nowMs:Date.UTC(2026,10,5,11,0)
 });
 assert.deepEqual(result,{
  status:"unavailable",reason:"missing_ledger",verifiedPercent:null,milestones:[]
 });
});
