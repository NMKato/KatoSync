// NMKato Solutions — Stage4AG revocation race, source-only QA contracts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa/execution_fence_qa.rs", import.meta.url),
  "utf8"
);
const productionPrefix = source.slice(0, source.indexOf("#[cfg(test)]"));

test("revocation gate and all Git spawning remain test-only", () => {
  assert.match(source, /#\[cfg\(test\)\]\s*#\[derive\(Debug, Default\)\]\s*struct QaLocalRevocationGate/);
  assert.doesNotMatch(productionPrefix, /QaLocalRevocationGate|Command::new|std::process::Command/);
  assert.match(source, /#\[cfg\(test\)\]\s*fn qa_execute_git_head_and_store_receipt/);
});
test("local revocation epoch is sticky and checked before Git launch", () => {
  assert.match(source, /generation: u64,\s*revoked: bool/);
  assert.match(source, /state\.revoked = true/);
  assert.ok(source.includes("checked_add(1)"));
  assert.match(source, /before_git\(\);[\s\S]*?let child = local_revoke\.commit_if_current\(generation, \|\| \{[\s\S]*?Command::new\("git"\)/);
});
test("revoked post-read result never reaches device signing or journal", () => {
  assert.match(source, /after_git\(\);\s*local_revoke\.commit_if_current\(generation, \|\| \{/);
  assert.match(source, /fn commit_if_current<T>\(/);
  assert.match(source, /let state = self\s*\.state\s*\.lock\(\)/);
  assert.match(source, /if state\.revoked \|\| state\.generation != generation/);
  assert.match(source, /commit\(\)/);
  assert.match(source, /receipt_qa::persist_verified_receipt/);
});
test("negative fixtures cover prelaunch and postread revocation and sticky generation", () => {
  for (const name of [
    "stage4ag_revoke_between_fence_and_git_launch_denies_without_receipt",
    "stage4ag_revoke_after_git_read_denies_device_receipt_and_durable_commit",
    "stage4ag_revocation_generation_is_monotonic_sticky_and_cannot_rearm"
  ]) assert.ok(source.includes(name), name);
});
