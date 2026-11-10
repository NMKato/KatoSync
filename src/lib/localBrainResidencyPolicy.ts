// Created by NMKato Solutions
// Stage4K deterministic model-residency admission: no process management, I/O or token spend.
export interface ManagedLocalModel {
  id: string;
  runtimeVerified: boolean;
  weightsVerified: boolean;
  bytesWeights: number;
  bytesVision: number;
  contextOverheadBytes: number;
  runtimeOverheadBytes: number;
}
export interface HostMemoryEvidence {
  totalUnifiedBytes: number;
  conservativeReclaimableBytes: number;
  sampleAgeMs: number;
  memoryPressure: "normal" | "warning" | "critical" | "unknown";
  ownModelRunning: boolean;
  ownAliasVerified: boolean;
  ownInferenceBusy: boolean;
  foreignModelsDetected: number;
  appOpenOrMinimized: boolean;
}
export interface ResidencyDecision {
  state: "resident" | "warm_allowed" | "defer" | "degraded";
  reason: "already_owned" | "verified_sufficient_memory" |
    "missing_verified_package" | "untrusted_local_process" |
    "unreliable_memory_telemetry" | "insufficient_unified_memory" |
    "memory_pressure" | "app_not_open" | "own_model_under_pressure";
  keepCoordinator: true;
  stopForeignModels: false;
  gpuBudgetSeparate: false;
  pauseNewInference: boolean;
  releaseOwnWhenIdle: boolean;
}
// macOS unified GPU memory is part of the SAME shared pool, not a second allocation.
// Keep OS, other apps and KAI Desktop protected with 2 GiB headroom.
export const LOCAL_BRAIN_OS_RESERVE_BYTES = 2 * 1024 ** 3;
const MAX_SAMPLE_AGE_MS = 15_000;

export function decideLocalBrainResidency(
  model: ManagedLocalModel,
  host: HostMemoryEvidence
): ResidencyDecision {
  const result = (
    state: ResidencyDecision["state"],
    reason: ResidencyDecision["reason"],
    releaseOwnWhenIdle = false
  ): ResidencyDecision =>
    ({state, reason, keepCoordinator: true, stopForeignModels: false,
      gpuBudgetSeparate: false, pauseNewInference: state==="defer" || state==="degraded",
      releaseOwnWhenIdle});
  if (!host.appOpenOrMinimized) return result("defer", "app_not_open");
  if (!model.runtimeVerified || !model.weightsVerified)
    return result("defer", "missing_verified_package");
  if (host.ownModelRunning) {
    if (!host.ownAliasVerified) return result("defer", "untrusted_local_process");
    if (host.memoryPressure!=="normal" || host.sampleAgeMs>MAX_SAMPLE_AGE_MS) {
      return result("degraded", "own_model_under_pressure", !host.ownInferenceBusy);
    }
    return result("resident", "already_owned");
  }
  const budget = model.bytesWeights + model.bytesVision + model.contextOverheadBytes
    + model.runtimeOverheadBytes + LOCAL_BRAIN_OS_RESERVE_BYTES;
  const valid = [host.totalUnifiedBytes, host.conservativeReclaimableBytes, host.sampleAgeMs, budget]
    .every((value) => Number.isFinite(value) && value >= 0);
  if (!valid || host.totalUnifiedBytes <= 0 ||
      host.conservativeReclaimableBytes > host.totalUnifiedBytes ||
      host.sampleAgeMs > MAX_SAMPLE_AGE_MS ||
      host.memoryPressure === "unknown") return result("defer", "unreliable_memory_telemetry");
  if (host.memoryPressure !== "normal") return result("defer", "memory_pressure");
  if (host.conservativeReclaimableBytes < budget ||
      host.totalUnifiedBytes < budget) return result("defer", "insufficient_unified_memory");
  return result("warm_allowed", "verified_sufficient_memory");
}
