// Created by NMKato Solutions
// Reine, lokale Provider-Erkennung fuer eingefuegte API-Keys. Keine Netzwerkzugriffe, keine
// Probe-Requests, kein Fan-out: Ein Provider wird nur bei eindeutigem Key-Praefix vorgeschlagen.
// Alles andere verlangt eine kurze Nutzerauswahl. Das Ergebnis enthaelt nie Key-Material.
// Rust spiegelt die starken Familien (provider_manager::strong_key_family) und lehnt Konflikte ab.
import type { ApiProviderPreset } from "../types";

export type ApiKeyInferenceStatus = "empty" | "invalid" | "strong" | "ambiguous" | "unknown";
export type ApiKeyInvalidReason = "too_short" | "too_long" | "whitespace" | "non_ascii";
export type ApiKeyRule =
  | "anthropic_prefix"
  | "openrouter_prefix"
  | "xai_prefix"
  | "openai_project_prefix"
  | "generic_sk_prefix"
  | "zai_shape"
  | "plain_token";

export interface ApiKeyInference {
  status: ApiKeyInferenceStatus;
  // Nur bei `strong` gesetzt. Bei allen anderen Zustaenden entscheidet der Nutzer.
  suggested: ApiProviderPreset | null;
  // Kurze, geordnete Auswahl. Bei `strong` die Familie (z. B. OpenRouter EU/Global).
  candidates: ApiProviderPreset[];
  rule: ApiKeyRule | null;
  invalidReason: ApiKeyInvalidReason | null;
}

const MIN_KEY_LENGTH = 16;
const MAX_KEY_LENGTH = 512;

// Reihenfolge der Vollauswahl bei unbekanntem Format.
export const API_PRESET_CHOICE_ORDER: ApiProviderPreset[] = [
  "openai",
  "anthropic",
  "openrouter_eu",
  "openrouter_global",
  "deepseek",
  "mistral",
  "xai",
  "zai",
  "custom_openai"
];

interface StrongRule {
  rule: ApiKeyRule;
  prefix: string;
  family: ApiProviderPreset[];
}

// Nur dokumentierte, providerexklusive Praefixe. `sk-ant-` muss vor generischem `sk-` stehen.
const STRONG_RULES: StrongRule[] = [
  { rule: "anthropic_prefix", prefix: "sk-ant-", family: ["anthropic"] },
  { rule: "openrouter_prefix", prefix: "sk-or-", family: ["openrouter_eu", "openrouter_global"] },
  { rule: "openai_project_prefix", prefix: "sk-proj-", family: ["openai"] },
  { rule: "openai_project_prefix", prefix: "sk-svcacct-", family: ["openai"] },
  { rule: "xai_prefix", prefix: "xai-", family: ["xai"] }
];

/** Entfernt nur offensichtliche Kopier-Artefakte (Whitespace, Quotes, `Bearer `). */
export function normalizeApiKeyInput(raw: string): string {
  let value = raw.trim();
  if (/^bearer\s+/i.test(value)) value = value.replace(/^bearer\s+/i, "");
  if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1).trim();
  return value;
}

function invalidReason(key: string): ApiKeyInvalidReason | null {
  if (/\s/.test(key)) return "whitespace";
  if (!/^[\x21-\x7e]+$/.test(key)) return "non_ascii";
  if (key.length < MIN_KEY_LENGTH) return "too_short";
  if (key.length > MAX_KEY_LENGTH) return "too_long";
  return null;
}

function result(
  status: ApiKeyInferenceStatus,
  candidates: ApiProviderPreset[],
  rule: ApiKeyRule | null,
  reason: ApiKeyInvalidReason | null = null
): ApiKeyInference {
  return {
    status,
    suggested: status === "strong" ? candidates[0] ?? null : null,
    candidates: [...candidates],
    rule,
    invalidReason: reason
  };
}

/** Lokale Klassifikation des Key-Formats. Sendet nichts und gibt keine Key-Teile zurueck. */
export function inferApiProviderFromKey(raw: string): ApiKeyInference {
  const key = normalizeApiKeyInput(raw);
  if (!key) return result("empty", [], null);
  const invalid = invalidReason(key);
  if (invalid) return result("invalid", [], null, invalid);

  const strong = STRONG_RULES.find((entry) => key.startsWith(entry.prefix));
  if (strong) return result("strong", strong.family, strong.rule);

  // `sk-` ohne exklusives Praefix: Legacy-OpenAI, DeepSeek und viele kompatible Gateways.
  if (key.startsWith("sk-")) return result("ambiguous", ["openai", "deepseek", "custom_openai"], "generic_sk_prefix");
  // Z.AI nutzt typischerweise `<hex>.<token>`, ist aber nicht exklusiv genug fuer Auto-Auswahl.
  if (/^[0-9a-f]{32}\.[A-Za-z0-9]{16}$/.test(key)) return result("ambiguous", ["zai", "custom_openai"], "zai_shape");
  // Reine alphanumerische Tokens (u. a. Mistral) sind nicht eindeutig zuordenbar.
  if (/^[A-Za-z0-9]{32}$/.test(key)) return result("ambiguous", ["mistral", "custom_openai"], "plain_token");

  return result("unknown", API_PRESET_CHOICE_ORDER, null);
}

/** Familie, die ein Key mit exklusivem Praefix zwingend verlangt; sonst null. */
export function strongKeyFamily(raw: string): ApiProviderPreset[] | null {
  const inference = inferApiProviderFromKey(raw);
  return inference.status === "strong" ? inference.candidates : null;
}

/**
 * Fail-closed-Schutz: ein eindeutig einem Provider zuordenbarer Key darf nie an einen anderen
 * Preset-Provider gesendet werden. Custom-Endpunkte bleiben bewusst erlaubt (eigene Gateways).
 */
export function keyConflictsWithPreset(raw: string, preset: ApiProviderPreset): boolean {
  if (preset === "custom_openai") return false;
  const family = strongKeyFamily(raw);
  return family !== null && !family.includes(preset);
}
