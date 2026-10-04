// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  GEMMA_4_E4B_IT_Q4,
  localBrainDownloadGb,
  localBrainFit,
  recommendedLocalBrain
} from "../src/lib/localBrainCatalog.ts";

test("Gemma 4 E4B Q4 is the recommended first Local Brain", () => {
  const model = recommendedLocalBrain();
  assert.equal(model.id, "gemma-4-e4b-it-q4_0");
  assert.equal(model.runtime, "llama_cpp");
  assert.equal(model.protocol, "open_ai_compatible");
  assert.equal(model.quantization, "Q4_0");
  assert.equal(model.license, "Apache-2.0");
  assert.equal(model.textArtifact.sha256.length, 64);
  assert.equal(localBrainDownloadGb(model), 4.59);
});

test("16 GB class machines are the preferred target", () => {
  assert.equal(localBrainFit(GEMMA_4_E4B_IT_Q4, 8), "unsupported");
  assert.equal(localBrainFit(GEMMA_4_E4B_IT_Q4, 12), "supported");
  assert.equal(localBrainFit(GEMMA_4_E4B_IT_Q4, 16), "recommended");
});

test("text package is not falsely advertised as complete multimodal install", () => {
  assert.equal(GEMMA_4_E4B_IT_Q4.visionProjectionRequired, true);
  assert.equal(GEMMA_4_E4B_IT_Q4.capabilities.image, false);
});
