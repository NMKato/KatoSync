// Created by NMKato Solutions

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

export const GEMMA_4_E4B_IT_Q4: LocalBrainModelDefinition = {
  id: "gemma-4-e4b-it-q4_0",
  displayName: "Kato Local Brain · Gemma 4 E4B",
  runtime: "llama_cpp",
  protocol: "open_ai_compatible",
  quantization: "Q4_0",
  license: "Apache-2.0",
  recommended: true,
  minimumRamGb: 12,
  preferredRamGb: 16,
  textArtifact: {
    fileName: "gemma-4-E4B-it-Q4_0.gguf",
    sourceRepo: "ggml-org/gemma-4-E4B-it-GGUF",
    sourceRevision: "main",
    sha256: "a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2",
    sizeBytes: 4_590_000_000
  },
  // Gemma 4 Vision wird in llama.cpp als separates Projektor-Artefakt geladen.
  // Der v1-Installer darf deshalb Text-Gewichte nicht fälschlich als vollständiges Vision-Paket melden.
  visionProjectionRequired: true,
  capabilities: {
    text: true,
    code: true,
    tools: true,
    image: false,
    audio: false
  }
};

export const LOCAL_BRAIN_CATALOG = [GEMMA_4_E4B_IT_Q4] as const;

export function recommendedLocalBrain(): LocalBrainModelDefinition {
  return LOCAL_BRAIN_CATALOG.find((model) => model.recommended) ?? LOCAL_BRAIN_CATALOG[0];
}

export function localBrainFit(
  model: LocalBrainModelDefinition,
  ramGb: number
): "unsupported" | "supported" | "recommended" {
  if (!Number.isFinite(ramGb) || ramGb < model.minimumRamGb) return "unsupported";
  if (ramGb < model.preferredRamGb) return "supported";
  return "recommended";
}

export function localBrainDownloadGb(model: LocalBrainModelDefinition): number {
  return Math.round((model.textArtifact.sizeBytes / 1_000_000_000) * 100) / 100;
}
