// NMKato Solutions — no cloud/no duplicate-weight carryover for Stage4J QA
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("../scripts/qa-stage4j-adopt-verified-gemma-m2.py",import.meta.url),"utf8");
test("Gemma model handover defaults to read-only preflight",()=>{
  assert.match(s,/else "--preflight"/);
  assert.match(s,/action not in \("--preflight", "--adopt-clone"\)/);
  assert.match(s,/STAGE4J_GEMMA_APFS_CLONE_PREFLIGHT_PASS/);
});
test("Gemma package and vision projector must both match pinned manifest",()=>{
  assert.match(s,/def verified_file/);
  assert.match(s,/model\["sha256"\]/);
  assert.match(s,/model\["mmproj"\]\["sha256"\]/);
  assert.match(s,/STAGE4J_ORIGINAL_LEDGER_MANIFEST_MISMATCH/);
  assert.match(s,/STAGE4J_PACKAGE_HASH_OR_SIZE_MISMATCH/);
});
test("new isolated app must own an empty target and no local inference server",()=>{
  assert.match(s,/TARGET_EXE_SHA/);
  assert.match(s,/STAGE4J_TARGET_NOT_EMPTY/);
  assert.match(s,/STAGE4J_LOCAL_BRAIN_SERVER_RUNNING/);
  assert.match(s,/STAGE4J_APFS_CLONE_REQUIRES_SAME_VOLUME/);
});
test("use APFS clone, never a hard link, never overwrite or migrate executable runtime",()=>{
  assert.match(s,/run\("\/bin\/cp", "-c"/);
  assert.match(s,/STAGE4J_COPIED_FILE_IS_HARDLINK/);
  assert.match(s,/TemporaryDirectory/);
  assert.match(s,/STAGE4J_UNTRUSTED_RUNTIME_CARRYOVER_DENIED/);
  assert.match(s,/os.rename\(stage, NEW_ROOT\)/);
  assert.doesNotMatch(s,/\b(killall|pkill|notarytool|git push|shutil\.rmtree)\b/);
});
