// NMKato Solutions — offline-only Stage4E staging admission review.
// Intentionally cannot deploy, create a project, approve billing or attest JWTs.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync,readFileSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {inspectOfflineStagingManifest,validateJwtTemplate} from
 "../release-candidates/stage4e/staging/preflight.mjs";

const TARGET="abcdefghijklmnopqrst";
const valid=()=>({
 schema_version:1,
 intended_use:"KatoSync Stage4E isolated staging — NO DEPLOY",
 organization_id:"ltlrzbposrcooqjnmcrg",
 project_ref:TARGET,
 project_url:"https://"+TARGET+".supabase.co",
 region:"eu-central-1",
 endpoint:"mesh-inbox-terminal-owner-qa",
 auth_policy:"gateway_verify_jwt_required",
 database_access:"dedicated_nonprod_only",
 production_data_access:false,
 deployment_requested:false
});
const preflight=fileURLToPath(new URL(
 "../release-candidates/stage4e/staging/preflight.mjs",import.meta.url));

test("valid synthetic preflight is explicitly NOT cloud or release authorization",()=>{
 const r=inspectOfflineStagingManifest(valid());
 assert.equal(r.status,"KATOSYNC_STAGE4E_STAGING_PREFLIGHT_ONLY_PASS_NO_DEPLOY");
 assert.equal(r.inspectedSources,4);
 for(const f of ["staticOnly","actualProjectExistenceVerified",
  "actualJWTGatewayVerified","independentReviewerVerified",
  "billingApprovalGranted","cloudDeploymentAuthorized",
  "productionReleaseAuthorized"])
  assert.equal(r[f],f==="staticOnly",f);
 assert.equal(r.projectRef,TARGET);
});
test("all four existing Supabase projects fail isolation even when called staging",()=>{
 for(const ref of ["xbnnlyyxiilklsygxcof","ahhrwojxuzpmtosblcxi",
  "rbkklqkzviwmxhxokdig","fsfxjlzvmjtkhjmscftf"]){
  assert.throws(()=>inspectOfflineStagingManifest({
   ...valid(),project_ref:ref,project_url:"https://"+ref+".supabase.co"
  }),/STAGING_PREFLIGHT_EXISTING_PROJECT_IS_NOT_STAGING/);
 }
});
test("noncanonical project ref/origin cannot redirect approval to other tenants",()=>{
 for(const pair of [
  ["abcdefghijklmnopqrst","https://xbnnlyyxiilklsygxcof.supabase.co"],
  ["abcdefghijklmnopqrst","http://abcdefghijklmnopqrst.supabase.co"],
  ["abcdefghijklmnopqrst","https://abcdefghijklmnopqrst.supabase.co/"],
  ["abcdefghijklmnopqrst","https://abcdefghijklmnopqrst.supabase.co@evil.test"],
  ["ABcdefghijklmnopqrst","https://abcdefghijklmnopqrst.supabase.co"],
  ["abcdefghijklmnopqrs","https://abcdefghijklmnopqrs.supabase.co"],
  ["abcdefghijklmnopqrst","https://abcdefghijklmnopqrst.supabase.co:443"],
 ]){
  assert.throws(()=>inspectOfflineStagingManifest({
   ...valid(),project_ref:pair[0],project_url:pair[1]
  }),/STAGING_PREFLIGHT_(INVALID_PROJECT_REF|PROJECT_ORIGIN_MISMATCH)/);
 }
});
test("billing/production/foreign-org flags cannot be represented as approved",()=>{
 for(const change of [
  {organization_id:"00000000000000000000"},
  {intended_use:"production"},
  {region:"us-east-1"},{auth_policy:"skip_verify_jwt"},
  {database_access:"production-shared"},{production_data_access:true},
  {deployment_requested:true},{endpoint:"mesh-inbox-receive"}
 ]){
  assert.throws(()=>inspectOfflineStagingManifest({...valid(),...change}),
   /STAGING_PREFLIGHT_UNAPPROVED_ENVIRONMENT/);
 }
});
test("unknown manifest keys including privileged secrets are always rejected",()=>{
 for(const key of ["service_role_key","approved","auto_deploy",
  "reviewer_signature","cost_approved","supabase_access_token"]){
  assert.throws(()=>inspectOfflineStagingManifest({...valid(),[key]:true}),
   /STAGING_PREFLIGHT_UNEXPECTED_MANIFEST_SHAPE/);
 }
 assert.throws(()=>inspectOfflineStagingManifest(null),
  /STAGING_PREFLIGHT_UNEXPECTED_MANIFEST_SHAPE/);
});
test("JWT template must explicitly opt in to gateway verification, no other functions",()=>{
 const ok=readFileSync(new URL(
  "../release-candidates/stage4e/staging/edge-functions.toml",import.meta.url),"utf8");
 assert.equal(validateJwtTemplate(ok),true);
 for(const candidate of [
  ok.replace("verify_jwt = true","verify_jwt = false"),
  ok.replace("verify_jwt = true","verify_jwt = 'true'"),
  ok+"\n[functions.mesh-inbox-receive]\nverify_jwt = false",
  ok+"\n[functions.untrusted]\nverify_jwt = true",
  ok+"\nverify_jwt = false",
  ok+"\nverify_jwt = true",
  ok.replace("[functions.mesh-inbox-terminal-owner-qa]","[functions.other]"),
  ok+"\n--no-verify-jwt",
  ok+"\nsupabase functions deploy foo"
 ])assert.throws(()=>validateJwtTemplate(candidate),/STAGING_PREFLIGHT_/);
});
test("manifest CLI refuses missing explicit offline flag and forbids keys",()=>{
 const dir=mkdtempSync(join(tmpdir(),"ksstage4e-test-"));
 const path=join(dir,"manifest.json");
 try{
  writeFileSync(path,JSON.stringify(valid()));
  const go=args=>spawnSync(process.execPath,[preflight,...args],{
   encoding:"utf8",timeout:5000});
  const good=go(["--manifest",path,"--offline-static-only"]);
  assert.equal(good.status,0,good.stderr);
  const body=JSON.parse(good.stdout);
  assert.equal(body.actualProjectExistenceVerified,false);
  assert.equal(body.cloudDeploymentAuthorized,false);
  assert.equal(body.productionReleaseAuthorized,false);
  for(const args of [[],["--manifest",path],
   ["--manifest",path,"--approve-and-deploy"],
   ["--project-ref","xbnnlyyxiilklsygxcof"]]){
   const bad=go(args);
   assert.notEqual(bad.status,0);
   assert.match(bad.stderr,/STAGING_PREFLIGHT_REJECTED/);
  }
  writeFileSync(path,JSON.stringify({...valid(),project_ref:"xbnnlyyxiilklsygxcof",
   project_url:"https://xbnnlyyxiilklsygxcof.supabase.co"}));
  const prod=go(["--manifest",path,"--offline-static-only"]);
  assert.notEqual(prod.status,0);
  assert.match(prod.stderr,/EXISTING_PROJECT_IS_NOT_STAGING/);
  writeFileSync(path,JSON.stringify(valid())+"\nBearer TEST-SENSITIVE-VALUE");
  const secret=go(["--manifest",path,"--offline-static-only"]);
  assert.notEqual(secret.status,0);
  assert.doesNotMatch(secret.stderr,/TEST-SENSITIVE-VALUE/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("pinned source fingerprints match historical QA candidate and Edge handler",()=>{
 const pins={
  "supabase/functions/mesh-inbox-terminal-owner-qa/index.ts":
   "4d1e1c563fab4f1fead5be258f366d722dec3819635d2ccd5aff6e2a4234ae68",
  "supabase/functions/mesh-inbox-terminal-owner-qa/handler.ts":
   "f64a73d7cf16b79c18023fbd6e75be1d1be89e45bff8a9d045282a3bc109859c",
  "release-candidates/stage4e/qa_only_hardening_candidate.sql":
   "7a8418bee574c0ad34c4454ffa084ef0a19c2eb1acba586ecf1e2ee9ec783504",
  "tests/sql/mesh_stage4e_atomic_write_overlay_qa.sql":
   "a1afad3bb0327456155774b2393d921366733c4abb915e7f5e88457052ef085b"
 };
 for(const [f,expected] of Object.entries(pins)){
  const original=readFileSync(new URL("../"+f,import.meta.url),"utf8");
  assert.equal(createHash("sha256").update(original.replace(/\r\n/g,"\n"))
   .digest("hex"),expected,f);
 }
});
test("manifest example intentionally cannot be mistaken for a real Supabase project",()=>{
 const raw=readFileSync(new URL(
  "../release-candidates/stage4e/staging/manifest.example.json",import.meta.url),"utf8");
 const example=JSON.parse(raw);
 assert.match(example.project_ref,/^REPLACE_WITH_/);
 assert.match(example.project_url,/^REPLACE_WITH_/);
 assert.equal(example.production_data_access,false);
 assert.equal(example.deployment_requested,false);
 assert.throws(()=>inspectOfflineStagingManifest(example),
  /STAGING_PREFLIGHT_INVALID_PROJECT_REF/);
});

test("repository contains no active Supabase config or staged deployment path",()=>{
 assert.equal(existsSync(new URL("../supabase/config.toml",import.meta.url)),false);
 const file=readFileSync(new URL(
  "../release-candidates/stage4e/staging/preflight.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(file,/\b(create_project|apply_migration|deploy_edge_function)\s*\(/);
 assert.match(file,/productionReleaseAuthorized:false/);
 assert.match(file,/cloudDeploymentAuthorized:false/);
});
