// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import manifest from "../src/lib/localBrainManifest.json" with { type: "json" };
import {
  GEMMA_4_E4B_IT_Q4,
  localBrainDownloadGb,
  localBrainFit,
  localBrainProviderConfig,
  localBrainReleaseBlockers,
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

test("model package metadata is versioned, separate from the runtime and layout-pinned", () => {
  const pkg = GEMMA_4_E4B_IT_Q4.package;
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.channel, "stable");
  assert.equal(pkg.objectKey, `packages/${pkg.packageId}/${pkg.version}/${GEMMA_4_E4B_IT_Q4.textArtifact.fileName}`);
  assert.deepEqual(pkg.runtime.versions, [manifest.runtime.version]);
  assert.deepEqual([...pkg.platforms].sort(), Object.keys(manifest.runtime.targets).sort());
  assert.equal(pkg.license.spdx, "Apache-2.0");
});

test("embedded manifest carries no credentials, signed URLs or own-channel base yet", () => {
  assert.equal(manifest.distribution.baseUrl, null);
  assert.deepEqual(manifest.distribution.redirectHosts, ["release-assets.githubusercontent.com", "*.hf.co"]);
  const urls = [...manifest.models.map((entry) => entry.url), ...Object.values(manifest.runtime.targets).map((t) => t.url)];
  for (const raw of urls) {
    const url = new URL(raw);
    assert.equal(url.protocol, "https:");
    assert.equal(url.search, "");
    assert.equal(url.username + url.password, "");
    assert.ok(manifest.distribution.allowedHosts.includes(url.hostname), url.hostname);
  }
  for (const target of Object.values(manifest.runtime.targets)) {
    assert.ok(Number.isSafeInteger(target.sizeBytes) && target.sizeBytes > 0);
    assert.match(target.sha256, /^[0-9a-f]{64}$/);
  }
  for (const entry of manifest.models) {
    assert.equal(entry.package.objectKey.includes("/latest/"), false);
    assert.ok(entry.package.objectKey.includes(`/${entry.package.version}/`));
  }
  assert.doesNotMatch(JSON.stringify(manifest), /secret|signature|password|bearer|api.?key|account.?id|access.?key|x-amz-|[?&]token=/i);
});

test("release gate keeps the package non-public until license and redistribution review", () => {
  const pkg = GEMMA_4_E4B_IT_Q4.package;
  const blockers = localBrainReleaseBlockers(pkg);
  assert.ok(blockers.includes("redistribution_not_approved"));
  assert.notEqual(pkg.releaseState, "public");

  const reviewed = {
    ...pkg,
    license: {
      ...pkg.license,
      noticeRefs: [`packages/${pkg.packageId}/${pkg.version}/NOTICE`],
      redistribution: {
        status: "approved" as const,
        reviewedBy: "NMKato",
        reviewedAt: "2026-10-06",
        basis: "Apache-2.0 mit NOTICE"
      }
    }
  };
  assert.deepEqual(localBrainReleaseBlockers(reviewed), []);
  assert.deepEqual(
    localBrainReleaseBlockers({ ...reviewed, license: { ...reviewed.license, userAcceptanceRequired: true } }),
    ["acceptance_text_missing"]
  );
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
    packageId: "kato-local-brain-gemma-4-e4b",
    packageVersion: "1.0.0",
    packageChannel: "stable",
    releaseState: "internal",
    releaseBlockers: ["redistribution_not_approved"],
    installedVersion: "1.0.0",
    previousVersion: null,
    pinnedVersion: null,
    updateState: "current",
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
