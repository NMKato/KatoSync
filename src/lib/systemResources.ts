// Created by NMKato Solutions
// Interpret measured host resources; estimates are advisory, never process-kill commands.
export type WarmupRecommendation = "headroom" | "caution" | "constrained";
export interface GpuObservation {
  name: string | null;
  memoryKind: "unified" | "dedicated" | "unknown";
  totalVramBytes: number | null;
  utilizationPercent: number | null;
  backend: string;
  evidence: string;
}
export interface ExternalModelProcess {
  label: string;
  instances: number;
  ramBytes: number;
}
export interface RuntimeBackendCapability {
  runtimeInstalled: boolean;
  selected: "cpu" | "metal" | "cuda" | "vulkan";
  enumerated: boolean;
  reason: string;
  inferenceVerified: boolean;
  freeDeviceMib: number | null;
}
export interface ResourceSnapshot {
  measuredAt: string;
  os: string;
  totalRamBytes: number;
  availableRamBytes: number;
  usedRamBytes: number;
  cpuPercent: number | null;
  gpu: GpuObservation;
  externalModels: ExternalModelProcess[];
  modelDiskBytes: number;
  modelRamBudgetBytes: number;
  minimumFreeRamBytes: number;
  warmupRecommendation: WarmupRecommendation;
  localBrainBackend: RuntimeBackendCapability;
}
export function percentUsed(used: number, total: number): number | null {
  if (!(total > 0) || !Number.isFinite(total) || !Number.isFinite(used)) return null;
  return Math.round(Math.max(0, Math.min(100, used / total * 100)));
}
export function resourceWarning(snapshot: ResourceSnapshot): string | null {
  if (snapshot.warmupRecommendation === "constrained") {
    return "Wenig freier Speicher für Kato AI. Die lokale KI kann langsam starten oder Speicherdruck auslösen. Andere Programme bitte nur nach eigener Entscheidung schließen.";
  }
  if (snapshot.warmupRecommendation === "caution") {
    return "Kato AI benötigt voraussichtlich zusätzlichen freien Speicher. Bei mehreren lokalen KI-Modellen kann die Leistung sinken.";
  }
  return null;
}
export function formatGiB(bytes: number): string {
  return Number.isFinite(bytes) && bytes >= 0 ? (bytes / 1024 ** 3).toFixed(1) + " GB" : "—";
}
