// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  GEMMA_4_E4B_IT_Q4,
  localBrainDownloadGb,
  localBrainFit,
  localBrainProviderConfig,
  recommendedLocalBrain,
  shouldAdoptLocalBrain,
  type LocalBrainStatus
} from "../src/lib/localBrainCatalog.ts";
import type { LocalProviderConfig } from "../src/types.ts";

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

function brain(patch: Partial<LocalBrainStatus> = {}): LocalBrainStatus {
  return {
    supported: true,
    target: "macos-aarch64",
    ramGb: 16,
    ramFit: "recommended",
    runtimeId: "llama.cpp",
    runtimeVersion: "b11272",
    runtimeInstalled: true,
    modelId: "gemma-4-e4b-it-q4_0",
    modelName: "Gemma 4 E4B-it",
    modelInstalled: true,
    modelSizeBytes: 4_590_000_000,
    quantization: "Q4_0",
    license: "Apache-2.0",
    sourceRepo: "example/repo",
    sourceRevision: "rev",
    textReady: true,
    codeReady: true,
    toolsReady: true,
    audioReady: false,
    running: true,
    endpoint: "http://127.0.0.1:17842/v1",
    modelAlias: "kato-local-brain",
    visionReady: false,
    ...patch
  };
}

const unconfigured: LocalProviderConfig = { kind: "open_ai_compatible", baseUrl: "", model: "" };

test("healthy verified Local Brain runtime becomes the configured local lane", () => {
  assert.deepEqual(localBrainProviderConfig(brain()), {
    kind: "open_ai_compatible",
    baseUrl: "http://127.0.0.1:17842/v1",
    model: "kato-local-brain"
  });
  assert.equal(shouldAdoptLocalBrain(brain(), unconfigured), true);
});

test("absent or unverified Local Brain runtime never invents a configured lane", () => {
  assert.equal(localBrainProviderConfig(null), null);
  assert.equal(localBrainProviderConfig(brain({ running: false })), null);
  assert.equal(localBrainProviderConfig(brain({ modelInstalled: false })), null);
  assert.equal(localBrainProviderConfig(brain({ runtimeInstalled: false })), null);
  assert.equal(localBrainProviderConfig(brain({ modelAlias: " " })), null);
  assert.equal(shouldAdoptLocalBrain(brain({ running: false }), unconfigured), false);
  assert.equal(shouldAdoptLocalBrain(null, unconfigured), false);
});

test("Local Brain adoption is loopback-only and never overrides a user endpoint", () => {
  assert.equal(localBrainProviderConfig(brain({ endpoint: "http://192.168.1.20:17842/v1" })), null);
  assert.equal(localBrainProviderConfig(brain({ endpoint: "https://example.com/v1" })), null);
  assert.equal(localBrainProviderConfig(brain({ endpoint: "http://user:pw@127.0.0.1:17842/v1" })), null);
  assert.equal(localBrainProviderConfig(brain({ endpoint: "not a url" })), null);
  assert.equal(
    shouldAdoptLocalBrain(brain(), { kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "llama3" }),
    false
  );
});
