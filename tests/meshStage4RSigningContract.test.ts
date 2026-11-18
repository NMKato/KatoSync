// Created by NMKato Solutions – signing is QA-only, not installation.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const script=readFileSync(new URL("../scripts/sign-stage4r-built-qa-macos.sh",import.meta.url),"utf8");

test("signing requires pinned owner QA binary and current source commit",()=>{
 for(const phrase of [
  "KATOSYNC_STAGE4R_SIGN_QA_ONLY",
  "YES_NOTARIZE_BEFORE_USE",
  "KATOSYNC_STAGE4R_SOURCE_SHA",
  "KATOSYNC_STAGE4R_BINARY_SHA256",
  "STAGE4R_PINNED_SOURCE_AND_BINARY_REQUIRED",
  "STAGE4R_COMPILED_NATIVE_QA_ROUTES_PASS",
 ])assert.ok(script.includes(phrase),phrase);
});

test("only isolated signed QA bundle and unchanged original black Dock icon",()=>{
 assert.match(script,/com\.nmkato\.katosync\.meshqa\.stage4j-isolated/);
 assert.match(script,/\.KatoSync-Mesh-Stage4R-PairingQA/);
 assert.match(script,/codesign --verify --deep --strict/);
 assert.match(script,/icon\.icns/);
 assert.match(script,/STAGE4R_SIGNED_BUT_NOT_NOTARIZED_NOT_STARTED/);
 assert.doesNotMatch(script,/launchctl bootstrap|open -n|supabase db push|supabase functions deploy/);
});
