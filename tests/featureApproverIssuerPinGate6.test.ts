// NMKato Solutions — public QA authority pin / restricted secret bootstrap contract.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const publicMeta=JSON.parse(readFileSync(
  new URL("../docs/katosync-qa-issuer-public-key-v1.json",import.meta.url),"utf8"));
const rust=readFileSync(new URL(
  "../src-tauri/src/memory_fabric/acceptance_ledger/owner_authority.rs",import.meta.url),"utf8");
const nativeChecks=readFileSync(new URL(
  "../src-tauri/src/memory_fabric/acceptance_ledger/external_checks.rs",import.meta.url),"utf8");
const bootstrap=readFileSync(new URL(
  "../scripts/qa-bootstrap-owner-issuer.py",import.meta.url),"utf8");

test("QA issuer public key and SHA-256 are a hard-coded independent native trust anchor",()=>{
 assert.equal(publicMeta.protocol,"katosync-qa-issuer-pin/v1");
 assert.equal(publicMeta.stage,"qa");
 assert.equal(publicMeta.projectRef,"xbnnlyyxiilklsygxcof");
 assert.equal(publicMeta.keyAlgorithm,"Ed25519");
 const key=Buffer.from(publicMeta.publicKeyBase64Url.replace(/-/g,"+").replace(/_/g,"/"),"base64");
 assert.equal(key.length,32);
 const digest=createHash("sha256").update(key).digest("hex");
 assert.equal(digest,publicMeta.fingerprintSha256);
 assert.match(rust,new RegExp("QA_ISSUER_PUBLIC_KEY_B64URL: &str = \""+
   publicMeta.publicKeyBase64Url+"\""));
 assert.match(rust,new RegExp("QA_ISSUER_FINGERPRINT_SHA256: &str =\\s*\""+
   publicMeta.fingerprintSha256+"\""));
 assert.match(nativeChecks,/trusted_qa_issuer_key\(\)/);
 assert.match(nativeChecks,/fetch_current_qa_signed_owner_grant\(project_id\)\.await\?/);
 assert.match(nativeChecks,/same_admin_authority\(&current\)/);
 assert.doesNotMatch(JSON.stringify(publicMeta),/"privateKey"/);
});

test("issuer bootstrap requires explicit --apply, never prints or commits PKCS8",()=>{
 assert.match(bootstrap,/--apply/);
 assert.match(bootstrap,/QA_ISSUER_ALREADY_CONFIGURED_USE_REVIEWED_ROTATION/);
 assert.match(bootstrap,/tempfile\.mkstemp\(/);
 assert.match(bootstrap,/os\.unlink\(temp_path\)/);
 assert.match(bootstrap,/PRIVATE_KEY_EXPORTED=false/);
 const result=spawnSync(process.platform === "win32" ? "python" : "python3",[
  fileURLToPath(new URL("../scripts/qa-bootstrap-owner-issuer.py",import.meta.url))
 ],{encoding:"utf8",timeout:5000});
 assert.equal(result.status,1);
 assert.match(result.stderr,/QA_ISSUER_REQUIRES_EXPLICIT_APPLY/);
 assert.doesNotMatch(result.stdout,/PKCS8|PRIVATE_KEY_B64|SERVICE_ROLE/);
});
