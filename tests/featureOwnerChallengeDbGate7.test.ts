import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261105084427_katosync_feature_owner_one_time_challenge_gate7.sql",import.meta.url),"utf8");
const handler=readFileSync(new URL("../supabase/functions/feature-owner-challenge-qa/handler.ts",import.meta.url),"utf8");
const index=readFileSync(new URL("../supabase/functions/feature-owner-challenge-qa/index.ts",import.meta.url),"utf8");

test("Gate 7: all three authority tables remain server-only RLS, no default owner grants",()=>{
 for(const table of ["feature_approval_reviewers","feature_owner_challenges","feature_owner_review_decisions"]){
  assert.match(sql,new RegExp("CREATE TABLE katosync\\."+table+" \\("));
  assert.match(sql,new RegExp("ALTER TABLE katosync\\."+table+" ENABLE ROW LEVEL SECURITY"));
  assert.match(sql,new RegExp("REVOKE ALL ON katosync\\."+table+" FROM PUBLIC,\\s*anon,\\s*authenticated"));
  assert.doesNotMatch(sql,new RegExp("CREATE POLICY \\w+ ON katosync\\."+table));
 }
 assert.doesNotMatch(sql,/INSERT INTO katosync.feature_approval_reviewers VALUES|INSERT INTO katosync.feature_owner_review_decisions VALUES/);
});
test("Gate 7: nonce issued within DB lock and consumed once; nonprivileged users cannot call RPC",()=>{
 assert.match(sql,/FOR UPDATE OF g/);
 assert.match(sql,/extensions\.gen_random_bytes\(32\)/);
 assert.match(sql,/feature_owner_one_open_challenge/);
 assert.match(sql,/30 seconds/);
 assert.match(sql,/c\.consumed_at IS NULL AND c\.canceled_at IS NULL/);
 assert.match(sql,/feature_owner_challenge_no_replay/);
 assert.match(sql,/FEATURE_OWNER_CHALLENGE_IMMUTABLE/);
 for(const rpc of ["feature_owner_challenge_issue\\(text,uuid\\)",
  "feature_owner_challenge_consume\\(uuid,text,uuid,text,text\\)"]){
  assert.match(sql,new RegExp("REVOKE ALL ON FUNCTION katosync\\."+rpc));
  assert.match(sql,new RegExp("GRANT EXECUTE ON FUNCTION katosync\\."+rpc));
 }
 assert.doesNotMatch(sql,/SECURITY DEFINER/);
});
test("Gate 7: admin decision requires another active reviewer; no client-side approval route",()=>{
 assert.match(sql,/NEW\.reviewer_uid<>g\.subject_uid/);
 assert.match(sql,/r\.state='active'/);
 assert.match(sql,/c\.consumed_at IS NOT NULL/);
 assert.match(sql,/d\.decision='approved'/);
 assert.match(sql,/FEATURE_OWNER_INDEPENDENT_APPROVAL_REQUIRED/);
 assert.match(sql,/FEATURE_OWNER_REVIEW_APPEND_ONLY/);
 assert.match(sql,/FEATURE_REVIEWER_IMMUTABLE_AUTHORITY/);
 assert.match(index,/Deno\.serve/);
 assert.match(handler,/grantsRights:false/);
 assert.doesNotMatch(handler,/"approve"|"activate"/);
 assert.doesNotMatch(handler,/feature_owner_review_decisions|feature_approval_reviewers/);
});
