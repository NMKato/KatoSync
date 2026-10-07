// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  API_PRESET_CHOICE_ORDER,
  inferApiProviderFromKey,
  keyConflictsWithPreset,
  normalizeApiKeyInput,
  strongKeyFamily
} from "../src/lib/apiKeyInference.ts";

// Synthetische Testwerte: Praefix realistisch, Rest offensichtlich unecht.
const FAKE = "EXAMPLEONLY0000000000000000";

test("strong, unmistakable prefixes suggest exactly one provider family", () => {
  const anthropic = inferApiProviderFromKey(`sk-ant-api03-${FAKE}`);
  assert.equal(anthropic.status, "strong");
  assert.equal(anthropic.suggested, "anthropic");
  assert.deepEqual(anthropic.candidates, ["anthropic"]);

  const openai = inferApiProviderFromKey(`sk-proj-${FAKE}`);
  assert.equal(openai.status, "strong");
  assert.equal(openai.suggested, "openai");
  assert.equal(inferApiProviderFromKey(`sk-svcacct-${FAKE}`).suggested, "openai");

  const xai = inferApiProviderFromKey(`xai-${FAKE}`);
  assert.equal(xai.status, "strong");
  assert.equal(xai.suggested, "xai");

  // OpenRouter: ein Provider, zwei Routen -> EU als Vorschlag, Global waehlbar.
  const openrouter = inferApiProviderFromKey(`sk-or-v1-${FAKE}`);
  assert.equal(openrouter.status, "strong");
  assert.equal(openrouter.suggested, "openrouter_eu");
  assert.deepEqual(openrouter.candidates, ["openrouter_eu", "openrouter_global"]);
});

test("ambiguous formats never auto-select a provider and offer a short choice", () => {
  const genericSk = inferApiProviderFromKey(`sk-${FAKE}`);
  assert.equal(genericSk.status, "ambiguous");
  assert.equal(genericSk.suggested, null);
  assert.deepEqual(genericSk.candidates, ["openai", "deepseek", "custom_openai"]);

  const zaiShape = inferApiProviderFromKey("0123456789abcdef0123456789abcdef.EXAMPLEONLY00000");
  assert.equal(zaiShape.status, "ambiguous");
  assert.equal(zaiShape.suggested, null);
  assert.equal(zaiShape.candidates[0], "zai");

  const plain = inferApiProviderFromKey("EXAMPLEONLY000000000000000000000");
  assert.equal(plain.status, "ambiguous");
  assert.equal(plain.suggested, null);
  assert.ok(plain.candidates.includes("mistral"));
  assert.ok(plain.candidates.length <= 3);
});

test("unknown formats require a user choice across all presets, including custom", () => {
  const unknown = inferApiProviderFromKey(`gw_${FAKE}`);
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.suggested, null);
  assert.deepEqual(unknown.candidates, API_PRESET_CHOICE_ORDER);
  assert.ok(unknown.candidates.includes("custom_openai"));
});

test("empty and malformed input is classified without guessing", () => {
  assert.equal(inferApiProviderFromKey("   ").status, "empty");
  const short = inferApiProviderFromKey("sk-ant-x");
  assert.equal(short.status, "invalid");
  assert.equal(short.invalidReason, "too_short");
  assert.equal(short.suggested, null);
  assert.equal(inferApiProviderFromKey(`sk-ant-${FAKE} extra`).invalidReason, "whitespace");
  assert.equal(inferApiProviderFromKey(`sk-ant-${FAKE}ü`).invalidReason, "non_ascii");
  assert.equal(inferApiProviderFromKey(`sk-${"a".repeat(600)}`).invalidReason, "too_long");
});

test("copy artifacts are normalized before detection", () => {
  assert.equal(normalizeApiKeyInput(`  Bearer sk-ant-${FAKE}\n`), `sk-ant-${FAKE}`);
  assert.equal(normalizeApiKeyInput(`"xai-${FAKE}"`), `xai-${FAKE}`);
  assert.equal(inferApiProviderFromKey(`Bearer sk-ant-${FAKE}`).suggested, "anthropic");
});

test("inference never echoes key material in any field", () => {
  const secretTail = "SECRETTAILVALUE9876543210";
  for (const raw of [
    `sk-ant-api03-${secretTail}`,
    `sk-or-v1-${secretTail}`,
    `sk-${secretTail}`,
    `xai-${secretTail}`,
    `zz-${secretTail}`,
    `sk-ant-${secretTail} broken`
  ]) {
    const serialized = JSON.stringify(inferApiProviderFromKey(raw));
    assert.equal(serialized.includes(secretTail), false, serialized);
    assert.equal(serialized.includes(raw.trim()), false, serialized);
    assert.equal(JSON.stringify(strongKeyFamily(raw)).includes(secretTail), false);
  }
});

test("a strongly identified key is never allowed to go to a different preset provider", () => {
  const anthropicKey = `sk-ant-api03-${FAKE}`;
  assert.equal(keyConflictsWithPreset(anthropicKey, "openai"), true);
  assert.equal(keyConflictsWithPreset(anthropicKey, "openrouter_eu"), true);
  assert.equal(keyConflictsWithPreset(anthropicKey, "anthropic"), false);
  // Eigene Gateways bleiben bewusst erlaubt.
  assert.equal(keyConflictsWithPreset(anthropicKey, "custom_openai"), false);
  // OpenRouter-Keys duerfen beide OpenRouter-Routen nutzen.
  assert.equal(keyConflictsWithPreset(`sk-or-v1-${FAKE}`, "openrouter_global"), false);
  // Mehrdeutig -> Nutzerentscheidung, keine Blockade.
  assert.equal(keyConflictsWithPreset(`sk-${FAKE}`, "deepseek"), false);
});

test("inference is pure and offline: no fetch is ever attempted", () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("network forbidden");
  }) as typeof fetch;
  try {
    for (const raw of [`sk-ant-${FAKE}`, `sk-${FAKE}`, `gw_${FAKE}`, ""]) inferApiProviderFromKey(raw);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls, 0);
});
