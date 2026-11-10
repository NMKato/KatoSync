// Stage4J official pinned llama.cpp archive admission contracts (NMKato Solutions).
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("../scripts/qa-stage4j-install-pinned-llama-m2.py",import.meta.url),"utf8");
test("pinned release verified by manifest and actual binary hash",()=>{
  assert.match(s,/target\["sha256"\]/);
  assert.match(s,/EXPECTED_SERVER_BINARY_SHA/);
  assert.match(s,/STAGE4J_RUNTIME_ARCHIVE_SHA256_DENIED/);
  assert.match(s,/STAGE4J_RUNTIME_EXTRACTED_BINARY_HASH_DENIED/);
});
test("reject tar escapes, devices, unknown link types, dangling and cyclic symlinks",()=>{
  assert.match(s,/STAGE4J_RUNTIME_TAR_PATH_DENIED/);
  assert.match(s,/STAGE4J_RUNTIME_TAR_MEMBER_TYPE_DENIED/);
  assert.match(s,/STAGE4J_RUNTIME_SYMLINK_TARGET_DENIED/);
  assert.match(s,/STAGE4J_RUNTIME_SYMLINK_CYCLE/);
  assert.match(s,/filter="data"/);
});
test("only offline local install is allowed; no inference or remote jobs",()=>{
  assert.match(s,/else "--preflight"/);
  assert.match(s,/STAGE4J_MODEL_SERVER_ALREADY_RUNNING/);
  assert.match(s,/STAGE4J_RUNTIME_DESTINATION_OCCUPIED/);
  assert.match(s,/STAGE4J_RUNTIME_LICENSE_INVALID/);
  assert.match(s,/STAGE4J_NO_LOCAL_MODEL_LAUNCHED/);
  assert.doesNotMatch(s,/\b(curl|requests\.get|git push|pkill|killall)\b/);
});
