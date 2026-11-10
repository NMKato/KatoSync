// Created by NMKato Solutions
// Stage4J: a distinct signed app MUST NOT reuse Stage35 credentials or app-data.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const rust=read("src-tauri/src/lib.rs");
const gh=read("src-tauri/src/github_app_auth.rs");
const features=read("src-tauri/Cargo.toml");
const build=read("scripts/build-mesh-qa-stage4j-candidate-macos.sh");
const config=read("src-tauri/tauri.mesh-qa-stage4j.conf.json");
const binaryAudit=read("scripts/qa-stage4j-native-namespace-audit.py");

test("Stage4J inherits gated QA behavior but must isolate its OS credential namespace",()=>{
  assert.match(features,/stage4j-qa = \["stage35-qa"\]/);
  for(const source of [rust,gh]){
    assert.match(source,/#\[cfg\(all\(feature = "stage35-qa", not\(feature = "stage4j-qa"\)\)\)\]\s*const KEYCHAIN_SERVICE: &str = "com\.nmkato\.katosync\.katoos\.stage35\.qa";/);
    assert.match(source,/#\[cfg\(feature = "stage4j-qa"\)\]\s*const KEYCHAIN_SERVICE: &str = "com\.nmkato\.katosync\.katoos\.stage4j\.qa";/);
  }
});

test("Stage4J uses its own launch agent, config directory and logs",()=>{
  assert.match(rust,/#\[cfg\(all\(feature = "stage35-qa", not\(feature = "stage4j-qa"\)\)\)\]\s*const LAUNCH_AGENT_ID: &str = "com\.nmkato\.katosync\.meshqa\.stage35\.sync";/);
  assert.match(rust,/#\[cfg\(feature = "stage4j-qa"\)\]\s*const LAUNCH_AGENT_ID: &str = "com\.nmkato\.katosync\.meshqa\.stage4j\.sync";/);
  assert.equal((rust.match(/\.join\(if cfg!\(feature = "stage4j-qa"\)/g)??[]).length,2);
  assert.equal((rust.match(/"KatoSync Mesh QA Stage4J"/g)??[]).length,2);
  assert.match(rust,/fn app_support_dir\(\)/);
  assert.match(rust,/fn logs_dir\(\)/);
});

test("Stage4J private signed build never resumes or heartbeats Stage35 automatically",()=>{
  assert.match(build,/--features stage4j-qa/);
  assert.doesNotMatch(build,/--features stage35-qa/);
  assert.match(build,/VITE_STAGE35_AUTO_RESUME_QA=0 VITE_STAGE35_HEARTBEAT_QA=0/);
  assert.doesNotMatch(build,/VITE_STAGE35_AUTO_RESUME_QA=1|VITE_STAGE35_HEARTBEAT_QA=1/);
  assert.match(build,/\.KatoSync-Mesh-Stage4J-Isolated-Candidate/);
  assert.match(build,/com\.nmkato\.katosync\.meshqa\.stage4j-isolated/);
  assert.match(build,/KATOSYNC_STAGE4J_EXPECT_SHA/);
  assert.doesNotMatch(build,/notarytool submit|stapler staple|supabase db push|git push|open -a/);
});

test("Tauri embedded application identity must also be isolated, not just signed Info.plist",()=>{
  const parsed=JSON.parse(config);
  assert.equal(parsed.identifier,"com.nmkato.katosync.meshqa.stage4j-isolated");
  assert.equal(parsed.productName,"KatoSync Mesh QA Stage4J Isolated");
  assert.match(build,/--config src-tauri\/tauri\.mesh-qa-stage4j\.conf\.json/);
  assert.doesNotMatch(build,/--config src-tauri\/tauri\.mesh-qa-stage35\.conf\.json/);
});

test("built native executable must prove new Stage4J identity and exclude Stage35 secrets service",()=>{
  assert.match(build,/qa-stage4j-native-namespace-audit\.py" "\$BIN"/);
  for(const s of ["com.nmkato.katosync.meshqa.stage4j-isolated","com.nmkato.katosync.katoos.stage4j.qa","com.nmkato.katosync.meshqa.stage4j.sync",
    "com.nmkato.katosync.katoos.stage35.qa","com.nmkato.katosync.meshqa.stage35.sync"])
    assert.ok(binaryAudit.includes(s));
  assert.match(binaryAudit,/STAGE4J_NATIVE_NAMESPACE_DENIED/);
});

test("prior signed Stage4J distribution candidate and Stage35 remain untouched by build output",()=>{
  assert.match(build,/test ! -e "\$OUT"/);
  assert.match(build,/! -e "\$OUTDIR"/);
  assert.match(build,/\$HOME\/Applications\/KatoSync Mesh QA Stage35\.app/);
  assert.doesNotMatch(build,/OUTDIR="\$HOME\/Applications\/\.KatoSync-Mesh-Stage4J-Candidate"/);
  assert.doesNotMatch(build,/rm -rf.*\$BASE/);
});
