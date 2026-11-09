// NMKato Solutions — Stage4E isolated Supabase staging STATIC preflight.
// NO Supabase network, API calls, keyring, project create, SQL, migrations
// or deployments. A passing result is NEVER a production/staging approval.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const repo=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const stageDir=join(repo,"release-candidates/stage4e/staging");
const REF=/^[a-z0-9]{20}$/;
const PROTECTED_PROJECT_REFS=Object.freeze(new Set([
 "xbnnlyyxiilklsygxcof", // KatoOS production
 "ahhrwojxuzpmtosblcxi", // GENXLine
 "rbkklqkzviwmxhxokdig", // NMKato existing
 "fsfxjlzvmjtkhjmscftf"  // FoodTracker
]));
const expectedFiles=Object.freeze({
 "supabase/functions/mesh-inbox-terminal-owner-qa/index.ts":
  "4d1e1c563fab4f1fead5be258f366d722dec3819635d2ccd5aff6e2a4234ae68",
 "supabase/functions/mesh-inbox-terminal-owner-qa/handler.ts":
  "f64a73d7cf16b79c18023fbd6e75be1d1be89e45bff8a9d045282a3bc109859c",
 "release-candidates/stage4e/qa_only_hardening_candidate.sql":
  "7a8418bee574c0ad34c4454ffa084ef0a19c2eb1acba586ecf1e2ee9ec783504",
 "tests/sql/mesh_stage4e_atomic_write_overlay_qa.sql":
  "a1afad3bb0327456155774b2393d921366733c4abb915e7f5e88457052ef085b"
});
const manifestKeys=Object.freeze([
 "schema_version","intended_use","organization_id","project_ref",
 "project_url","region","endpoint","auth_policy",
 "database_access","production_data_access","deployment_requested"
]);
const safeHeader="KATOSYNC_STAGE4E_STAGING_PREFLIGHT_ONLY";

function canonicalText(file){
 const bytes=readFileSync(file);
 if(bytes.length>512*1024)throw Error("STAGING_PREFLIGHT_SOURCE_TOO_LARGE");
 const text=bytes.toString("utf8");
 if(text.includes("\uFFFD")||/\r(?!\n)/.test(text))
  throw Error("STAGING_PREFLIGHT_NONCANONICAL_SOURCE");
 return text.replace(/\r\n/g,"\n");
}
function hash(text){return createHash("sha256").update(text).digest("hex");}
export function validateJwtTemplate(config){
 if(typeof config!=="string")throw Error("STAGING_PREFLIGHT_CONFIG_NOT_TEXT");
 if(/verify_jwt\s*=\s*false\b/i.test(config))
  throw Error("STAGING_PREFLIGHT_INSECURE_JWT_BYPASS");
 const blocks=config.match(/^\[functions\.[^\]]+\]/gm)||[];
 if(blocks.length!==1||
    blocks[0]!=="[functions.mesh-inbox-terminal-owner-qa]")
  throw Error("STAGING_PREFLIGHT_UNEXPECTED_FUNCTION");
 const values=config.split("\n").map(x=>x.trim()).filter(x=>
    !x.startsWith("#")&&x.length>0);
 if(values.length!==2||
    values[0]!=="[functions.mesh-inbox-terminal-owner-qa]"||
    values[1]!=="verify_jwt = true")
  throw Error("STAGING_PREFLIGHT_VERIFY_JWT_NOT_EXPLICIT");
 if(/no-verify-jwt|supabase functions deploy|supabase db push/i.test(config))
  throw Error("STAGING_PREFLIGHT_DEPLOY_COMMAND_FORBIDDEN");
 return true;
}
function checkStaticSources(){
 for(const [file,want] of Object.entries(expectedFiles)){
  const got=hash(canonicalText(join(repo,file)));
  if(got!==want)throw Error("STAGING_PREFLIGHT_REVIEWED_SOURCE_CHANGED:"+file);
 }
 validateJwtTemplate(canonicalText(join(stageDir,"edge-functions.toml")));
 // The only hosting-specific config remains a QA template, not the
 // default supabase/config.toml used by regular deploy tooling.
 return {edgeConfigTemplate:"release-candidates/stage4e/staging/edge-functions.toml",
  inspectedSources:Object.keys(expectedFiles).length};
}
export function inspectOfflineStagingManifest(manifest){
 if(!manifest||typeof manifest!=="object"||Array.isArray(manifest)||
  Object.keys(manifest).length!==manifestKeys.length||
  Object.keys(manifest).some(k=>!manifestKeys.includes(k)))
  throw Error("STAGING_PREFLIGHT_UNEXPECTED_MANIFEST_SHAPE");
 if(manifest.schema_version!==1||
    manifest.intended_use!=="KatoSync Stage4E isolated staging — NO DEPLOY"||
    manifest.organization_id!=="ltlrzbposrcooqjnmcrg"||
    manifest.region!=="eu-central-1"||
    manifest.endpoint!=="mesh-inbox-terminal-owner-qa"||
    manifest.auth_policy!=="gateway_verify_jwt_required"||
    manifest.database_access!=="dedicated_nonprod_only"||
    manifest.production_data_access!==false||
    manifest.deployment_requested!==false)
  throw Error("STAGING_PREFLIGHT_UNAPPROVED_ENVIRONMENT");
 if(typeof manifest.project_ref!=="string"||!REF.test(manifest.project_ref))
  throw Error("STAGING_PREFLIGHT_INVALID_PROJECT_REF");
 if(PROTECTED_PROJECT_REFS.has(manifest.project_ref))
  throw Error("STAGING_PREFLIGHT_EXISTING_PROJECT_IS_NOT_STAGING");
 if(manifest.project_url!==
    "https://"+manifest.project_ref+".supabase.co")
  throw Error("STAGING_PREFLIGHT_PROJECT_ORIGIN_MISMATCH");
 const sources=checkStaticSources();
 return Object.freeze({
  status:safeHeader+"_PASS_NO_DEPLOY",
  inspectedSources:sources.inspectedSources,
  edgeConfigTemplate:sources.edgeConfigTemplate,
  projectRef:manifest.project_ref,
  staticOnly:true,
  actualProjectExistenceVerified:false,
  actualJWTGatewayVerified:false,
  independentReviewerVerified:false,
  billingApprovalGranted:false,
  cloudDeploymentAuthorized:false,
  productionReleaseAuthorized:false
 });
}
async function cli(){
 if(process.argv.length!==5||process.argv[2]!=="--manifest"||
    process.argv[4]!=="--offline-static-only")
  throw Error("STAGING_PREFLIGHT_USAGE_OFFLINE_ONLY");
 const filename=resolve(process.argv[3]);
 const bytes=readFileSync(filename);
 if(bytes.length>12*1024)throw Error("STAGING_PREFLIGHT_MANIFEST_TOO_LARGE");
 const text=bytes.toString("utf8");
 if(text.includes("\uFFFD")||/sb_secret_|SUPABASE_SERVICE_ROLE_KEY|postgresql:\/\/|Bearer /i.test(text))
  throw Error("STAGING_PREFLIGHT_SECRET_MATERIAL_FORBIDDEN");
 const result=inspectOfflineStagingManifest(JSON.parse(text));
 process.stdout.write(JSON.stringify(result)+"\n");
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 cli().catch(err=>{
  // Print only a stable denial reason, never a secret-bearing input.
  console.error("STAGING_PREFLIGHT_REJECTED:"+
   (String(err?.message).startsWith("STAGING_PREFLIGHT_")?
    String(err.message):"INVALID_INPUT_OR_UNAVAILABLE_SOURCE"));
  process.exitCode=3;
 });
}
