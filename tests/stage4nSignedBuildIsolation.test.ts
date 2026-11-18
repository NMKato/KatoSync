// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const build=read("scripts/build-mesh-qa-stage4j-candidate-macos.sh");
const native=read("src-tauri/src/local_brain.rs");
const scope=read("src-tauri/src/local_control/agent_scope.rs");

test("Stage4N has an unused output slot and requires pinned SHA",()=>{
  assert.match(build,/STAGE4N_SIGNED_20261110/);
  assert.match(build,/\.KatoSync-Mesh-Stage4N-TruthQA/);
  assert.match(build,/KatoSync Stage4N Truth QA/);
  assert.match(build,/STAGE4J_SOURCE_SHA_NOT_PINNED/);
  assert.match(build,/! -e "\$OUTDIR"/);
  assert.match(build,/STAGE4J_EXPLICIT_NOT_NOTARIZED_NOT_INSTALLED/);
});

test("Stage4N candidate retains fail-closed Local Brain and project scope",()=>{
  assert.match(native,/inference_readiness::inference_ready/);
  assert.match(native,/serves_alias\(HEALTH_URL, MODELS_URL, &model\.alias\)\.await/);
  assert.match(scope,/STAGE4L_REMOTE_PROVIDER_NOT_AUTHORIZED/);
  assert.match(scope,/STAGE4L_FOREIGN_REPOSITORY/);
});
