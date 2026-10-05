// Created by NMKato Solutions
// Zentraler, versionierter Modellkatalog fuer UX/Planung. Preise werden nur aufgenommen,
// wenn sie aus einer verifizierten Providerquelle stammen. Unbekannt bleibt bewusst null.
import type { ApiCapability, ApiEffort, ApiModelProfile, ApiProviderPreset } from "../types";

type CatalogEntry = Omit<ApiModelProfile, "id"> & { matches: RegExp };

const EFFORT_BASIC: ApiEffort[] = ["auto", "low", "medium", "high"];
const EFFORT_DEEP: ApiEffort[] = ["auto", "low", "medium", "high", "xhigh", "max"];
const CORE: ApiCapability[] = ["coding", "reasoning", "tools"];

const usd = (
  inputPerMillion: number,
  outputPerMillion: number,
  cachedInputPerMillion: number | null,
  effectiveAt: string,
  note?: string
) => ({
  currency: "USD" as const,
  inputPerMillion,
  cachedInputPerMillion,
  outputPerMillion,
  source: "verified_catalog" as const,
  effectiveAt,
  note: note ?? null
});

const CATALOG: Partial<Record<ApiProviderPreset, CatalogEntry[]>> = {
  openai: [
    {
      matches: /^gpt-6-astra(?:$|-)/i,
      displayName: "GPT-6 Astra",
      capabilities: [...CORE, "vision", "long_context"],
      supportedEfforts: EFFORT_DEEP,
      contextWindow: 1_050_000,
      pricing: usd(10, 50, 1, "2026-10-05", "Standard processing; long context and fast tiers can cost more."),
      speed: "deep"
    },
    {
      matches: /^gpt-5\.6(?:-sol)?(?:$|-)/i,
      displayName: "GPT-5.6 Sol",
      capabilities: [...CORE, "vision", "long_context"],
      supportedEfforts: EFFORT_DEEP,
      contextWindow: 1_050_000,
      pricing: usd(4, 20, 0.4, "2026-10-05", "Promotional standard pricing; long context can cost more."),
      speed: "balanced"
    },
    {
      matches: /^gpt-5\.6-terra(?:$|-)/i,
      displayName: "GPT-5.6 Terra",
      capabilities: [...CORE, "vision", "long_context"],
      supportedEfforts: EFFORT_DEEP,
      contextWindow: 1_050_000,
      pricing: usd(2, 12, 0.2, "2026-10-05", "Long context above 272K input tokens uses higher rates."),
      speed: "balanced"
    },
    {
      matches: /^gpt-5\.6-luna(?:$|-)/i,
      displayName: "GPT-5.6 Luna",
      capabilities: [...CORE, "vision", "long_context"],
      supportedEfforts: EFFORT_DEEP,
      contextWindow: 1_050_000,
      pricing: usd(0.2, 1.2, 0.02, "2026-10-05", "Standard processing below 272K input tokens."),
      speed: "fast"
    }
  ],
  anthropic: [
    {
      matches: /claude-opus-5[.-]5/i,
      displayName: "Claude Opus 5.5",
      capabilities: [...CORE, "long_context"],
      supportedEfforts: EFFORT_BASIC,
      contextWindow: null,
      pricing: usd(4, 20, 0.2, "2026-10-05"),
      speed: "deep"
    }
  ],
  deepseek: [
    {
      matches: /deepseek-(?:v4-)?flash/i,
      displayName: "DeepSeek V4 Flash",
      capabilities: [...CORE, "long_context"],
      supportedEfforts: ["auto", "low", "high", "max"],
      contextWindow: null,
      pricing: usd(0.3, 1.2, 0.006, "2026-10-05", "Conservative peak rate; official off-peak rates are 50% lower."),
      speed: "fast"
    },
    {
      matches: /deepseek-(?:v4-)?pro/i,
      displayName: "DeepSeek V4 Pro",
      capabilities: [...CORE, "long_context"],
      supportedEfforts: ["auto", "low", "high", "max"],
      contextWindow: null,
      pricing: usd(1.32, 3.96, 0.044, "2026-10-05", "Conservative peak rate; official off-peak rates are 50% lower."),
      speed: "deep"
    }
  ],
  xai: [
    {
      matches: /^grok-4\.7(?:$|-)/i,
      displayName: "Grok 4.7",
      capabilities: [...CORE, "vision"],
      supportedEfforts: ["auto", "low", "medium", "high", "xhigh"],
      contextWindow: 500_000,
      pricing: usd(2, 6, null, "2026-10-05"),
      speed: "balanced"
    },
    {
      matches: /^grok-4\.(?:5|6)(?:$|-)/i,
      displayName: "Grok 4.5 / 4.6",
      capabilities: [...CORE, "vision"],
      supportedEfforts: ["auto", "low", "medium", "high", "xhigh"],
      contextWindow: 500_000,
      pricing: usd(2, 6, null, "2026-10-05", "Long-context requests >=200K tokens use higher rates."),
      speed: "balanced"
    },
    {
      matches: /^grok-4\.3(?:$|-)/i,
      displayName: "Grok 4.3",
      capabilities: [...CORE, "vision", "long_context"],
      supportedEfforts: ["auto", "low", "medium", "high", "xhigh"],
      contextWindow: 1_000_000,
      pricing: usd(1.25, 2.5, 0.2, "2026-10-05", "Long-context requests >=200K tokens use higher rates."),
      speed: "fast"
    }
  ],
  mistral: [
    {
      matches: /mistral-medium/i,
      displayName: "Mistral Medium 3.5",
      capabilities: [...CORE, "vision"],
      supportedEfforts: EFFORT_BASIC,
      contextWindow: null,
      pricing: usd(1.5, 7.5, null, "2026-10-05"),
      speed: "deep"
    },
    {
      matches: /mistral-small/i,
      displayName: "Mistral Small 4",
      capabilities: [...CORE, "vision"],
      supportedEfforts: EFFORT_BASIC,
      contextWindow: null,
      pricing: usd(0.15, 0.6, null, "2026-10-05"),
      speed: "fast"
    },
    {
      matches: /mistral-large/i,
      displayName: "Mistral Large 3",
      capabilities: [...CORE, "vision"],
      supportedEfforts: EFFORT_BASIC,
      contextWindow: null,
      pricing: usd(0.5, 1.5, null, "2026-10-05"),
      speed: "balanced"
    },
    {
      matches: /zai-glm-5-2|glm-5\.2/i,
      displayName: "GLM 5.2 via Mistral",
      capabilities: [...CORE, "long_context"],
      supportedEfforts: EFFORT_BASIC,
      contextWindow: null,
      pricing: usd(1.4, 4.4, 0.14, "2026-10-05"),
      speed: "balanced"
    }
  ]
};

function inferredCapabilities(model: string): ApiCapability[] {
  const id = model.toLowerCase();
  const caps = new Set<ApiCapability>(["reasoning"]);
  if (/code|coder|codex|devstral|build/.test(id)) caps.add("coding");
  if (/vision|vl|image|gpt-6|grok-4/.test(id)) caps.add("vision");
  if (/image|imagine/.test(id)) caps.add("image");
  if (/video/.test(id)) caps.add("video");
  if (/1m|million|long|gpt-6|grok-4\.3/.test(id)) caps.add("long_context");
  if (!caps.has("image") && !caps.has("video")) caps.add("tools");
  return [...caps];
}

export function apiModelProfile(preset: ApiProviderPreset, model: string): ApiModelProfile {
  const known = CATALOG[preset]?.find((entry) => entry.matches.test(model));
  if (known) {
    return {
      id: model,
      displayName: known.displayName,
      capabilities: [...known.capabilities],
      supportedEfforts: [...known.supportedEfforts],
      contextWindow: known.contextWindow,
      pricing: known.pricing ? { ...known.pricing } : null,
      speed: known.speed
    };
  }

  return {
    id: model,
    displayName: model,
    capabilities: inferredCapabilities(model),
    supportedEfforts: EFFORT_BASIC,
    contextWindow: null,
    pricing: null,
    speed: "unknown"
  };
}

export function formatApiPrice(profile: ApiModelProfile): string {
  const price = profile.pricing;
  if (!price || price.inputPerMillion === null || price.outputPerMillion === null) return "Preis dynamisch / unbekannt";
  return `$${price.inputPerMillion}/M in · $${price.outputPerMillion}/M out`;
}
