// NMKato Solutions — isolated Stage4M native release QA slot.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const script=readFileSync(new URL("../scripts/build-mesh-qa-stage4j-candidate-macos.sh",import.meta.url),"utf8");
test("Stage4M signed candidate requires unique collision-free QA slot",()=>{
 assert.match(script,/READINESS_20261110/);
 assert.match(script,/\.KatoSync-Mesh-Stage4M-ReadinessQA/);
 assert.match(script,/KatoSync Stage4M Readiness QA/);
 assert.match(script,/KATOSYNC_STAGE4J_EXPECT_SHA/);
 assert.match(script,/! -e "\$OUTDIR"/);
 assert.match(script,/STAGE4J_INPUT_OR_OUTPUT_COLLISION/);
});
test("Stage4M candidate requires explicit release gate, without notary upload",()=>{
 assert.match(script,/codesign --force --deep --timestamp/);
 assert.match(script,/STAGE4J_EXPLICIT_NOT_NOTARIZED_NOT_INSTALLED/);
 assert.doesNotMatch(script,/\bnotarytool submit\b/);
});
