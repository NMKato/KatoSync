// Created by NMKato Solutions
// Stage4M source integration contracts; do not claim a live inference run.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../src-tauri/src/local_brain.rs",import.meta.url),"utf8");
const gate=readFileSync(new URL("../src-tauri/src/local_brain/inference_readiness.rs",import.meta.url),"utf8");
const status=source.split("pub async fn status(app: &AppHandle)")[1]?.split("fn emit_progress")[0]??"";
const start=source.split("pub async fn start(app: &AppHandle)")[1]?.split("pub fn stop_owned()")[0]??"";

test("live status requires installed runtime, installed weights and verified model alias",()=>{
  assert.match(source,/mod inference_readiness;/);
  assert.match(status,/status\.running\s*=\s*inference_readiness::inference_ready\(/);
  assert.match(status,/serves_alias\(HEALTH_URL, MODELS_URL, &status\.model_alias\)\.await/);
  assert.doesNotMatch(status,/status\.running\s*=\s*owned_child_alive\(\)/);
  assert.match(gate,/runtime_installed && model_installed && healthy_pinned_alias/);
});

test("model start waits for alias after health, not mere 200 health",()=>{
  assert.match(start,/for _ in 0\.\.45/);
  assert.match(start,/serves_alias\(HEALTH_URL, MODELS_URL, &model\.alias\)\.await/);
  assert.match(start,/if observed\.running \{/);
  assert.doesNotMatch(start,/client\.get\(HEALTH_URL\)/);
});

test("starting child may not be displayed as healthy or suppress model ownership checks",()=>{
  assert.match(status,/let _ = owned_child_alive\(\);/);
  assert.match(start,/MODEL_START_LOCK\.lock\(\)\.await/);
  assert.match(start,/local_brain_port_occupied\("127\.0\.0\.1:17842"\)/);
  assert.match(gate,/fn owned_child_liveness_never_implies_inference_ready/);
});
