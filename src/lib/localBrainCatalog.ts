// Created by NMKato Solutions
import manifest from "./localBrainManifest.json" with { type: "json" };
import type { LocalProviderConfig } from "../types";

export type LocalBrainRuntime = "llama_cpp";
export type LocalBrainQuantization = "Q4_0" | "Q8_0" | "BF16";

export interface LocalBrainArtifact {
  fileName: string;
  sourceRepo: string;
  sourceRevision: string;
  sha256: string;
  sizeBytes: number;
}

export interface LocalBrainModelDefinition {
  id: string;
  displayName: string;
  runtime: LocalBrainRuntime;
  protocol: "open_ai_compatible";
  quantization: LocalBrainQuantization;
  license: "Apache-2.0";
  recommended: boolean;
  minimumRamGb: number;
  preferredRamGb: number;
  textArtifact: LocalBrainArtifact;
  visionProjectionRequired: boolean;
  capabilities: {
    text: boolean;
    code: boolean;
    tools: boolean;
    image: boolean;
    audio: boolean;
  };
}

export interface LocalBrainStatus {
  supported: boolean;
  target: string;
  ramGb: number | null;
  ramFit: "unsupported" | "supported" | "recommended" | "unknown";
  runtimeId: string;
  runtimeVersion: string;
  runtimeInstalled: boolean;
  modelId: string;
  modelName: string;
  modelInstalled: boolean;
  modelSizeBytes: number;
  quantization: string;
  license: string;
  sourceRepo: string;
  sourceRevision: string;
  textReady: boolean;
  codeReady: boolean;
  toolsReady: boolean;
  audioReady: boolean;
  running: boolean;
  endpoint: string;
  modelAlias: string;
  visionReady: boolean;
}

export interface LocalBrainProgress {
  phase: "runtime" | "model" | "verify" | string;
  label: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

type ManifestModel = (typeof manifest.models)[number];
const model = manifest.models.find((entry) => entry.recommended) ?? manifest.models[0];

function toDefinition(entry: ManifestModel): LocalBrainModelDefinition {
  return {
    id: entry.id,
    displayName: entry.displayName,
    runtime: "llama_cpp",
    protocol: "open_ai_compatible",
    quantization: entry.quantization as LocalBrainQuantization,
    license: entry.license as "Apache-2.0",
    recommended: entry.recommended,
    minimumRamGb: entry.minimumRamGb,
    preferredRamGb: entry.preferredRamGb,
    textArtifact: {
      fileName: entry.fileName,
      sourceRepo: entry.sourceRepo,
      sourceRevision: entry.sourceRevision,
      sha256: entry.sha256,
      sizeBytes: entry.sizeBytes
    },
    // Vision/MMProj bleibt absichtlich separat, damit die UI keinen falschen
    // "voll multimodal installiert"-Status anzeigt, bevor das Projektor-Paket verifiziert ist.
    visionProjectionRequired: entry.visionProjectionRequired,
    capabilities: entry.capabilities
  };
}

export const GEMMA_4_E4B_IT_Q4: LocalBrainModelDefinition = toDefinition(model);
export const LOCAL_BRAIN_CATALOG = manifest.models.map(toDefinition);

export function recommendedLocalBrain(): LocalBrainModelDefinition {
  return LOCAL_BRAIN_CATALOG.find((entry) => entry.recommended) ?? LOCAL_BRAIN_CATALOG[0];
}

export function localBrainFit(
  entry: LocalBrainModelDefinition,
  ramGb: number
): "unsupported" | "supported" | "recommended" {
  if (!Number.isFinite(ramGb) || ramGb < entry.minimumRamGb) return "unsupported";
  if (ramGb < entry.preferredRamGb) return "supported";
  return "recommended";
}

export function localBrainDownloadGb(entry: LocalBrainModelDefinition): number {
  return Math.round((entry.textArtifact.sizeBytes / 1_000_000_000) * 100) / 100;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/// Lokale-Lane-Konfiguration fuer einen real laufenden Local Brain; null ohne verifizierte
/// Loopback-Runtime (nie Bereitschaft erfinden, nie auf LAN/Cloud ausweichen).
export function localBrainProviderConfig(brain: LocalBrainStatus | null): LocalProviderConfig | null {
  if (!brain?.running || !brain.runtimeInstalled || !brain.modelInstalled || !brain.modelAlias.trim()) return null;
  let url: URL;
  try {
    url = new URL(brain.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) return null;
  return { kind: "open_ai_compatible", baseUrl: brain.endpoint, model: brain.modelAlias };
}

/// Ein laufender Local Brain wird nur dann als lokale Lane uebernommen, wenn noch kein
/// eigener lokaler Endpoint konfiguriert ist; Nutzerkonfiguration wird nie ueberschrieben.
export function shouldAdoptLocalBrain(brain: LocalBrainStatus | null, current: LocalProviderConfig): boolean {
  return localBrainProviderConfig(brain) !== null && !current.baseUrl.trim();
}
