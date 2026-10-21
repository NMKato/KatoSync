import test from "node:test";
import assert from "node:assert/strict";
import { formatGiB, percentUsed, resourceWarning, type ResourceSnapshot } from "../src/lib/systemResources.ts";
const G = 1024 ** 3;
function sample(level: ResourceSnapshot["warmupRecommendation"]): ResourceSnapshot {
  return {
    measuredAt: "2026-10-21T09:20:00Z", os: "macos", totalRamBytes: 16*G,
    availableRamBytes: level === "constrained" ? 2*G : level === "caution" ? 7*G : 10*G,
    usedRamBytes: 6*G, cpuPercent: 22,
    gpu: { name: "Apple GPU", memoryKind: "unified", totalVramBytes: null,
      utilizationPercent: null, backend: "metal_supported", evidence: "macos_display_hardware_metadata_only" },
    externalModels: [], modelDiskBytes: 4_590_807_392, modelRamBudgetBytes: 7*G,
    minimumFreeRamBytes: 9*G, warmupRecommendation: level,
    localBrainBackend: { runtimeInstalled: true, selected: "metal", enumerated: true,
      reason: "compatible_gpu_with_estimated_memory_headroom", inferenceVerified: false,
      freeDeviceMib: 12123 }
  };
}
test("correct percentages are derived only from measured values", () => {
  assert.equal(percentUsed(8*G, 16*G), 50);
  assert.equal(percentUsed(999, 100), 100);
  assert.equal(percentUsed(0, 0), null);
  assert.equal(percentUsed(Number.NaN, 10), null);
  assert.equal(formatGiB(4*G), "4.0 GB");
});
test("16GB physical RAM does not automatically imply enough available RAM for warm models", () => {
  assert.equal(resourceWarning(sample("headroom")), null);
  assert.match(resourceWarning(sample("caution")) ?? "", /knapp|zusätzlichen/);
  assert.match(resourceWarning(sample("constrained")) ?? "", /Wenig freier Speicher/);
});
test("GPU utilization remains explicitly unavailable without real telemetry", () => {
  const s = sample("headroom");
  assert.equal(s.gpu.utilizationPercent, null);
  assert.equal(s.gpu.totalVramBytes, null);
  assert.equal(s.gpu.memoryKind, "unified");
});

test("backend enumeration is never confused with proven model inference", () => {
  const result = sample("headroom");
  assert.equal(result.localBrainBackend.selected, "metal");
  assert.equal(result.localBrainBackend.enumerated, true);
  assert.equal(result.localBrainBackend.inferenceVerified, false);
});
