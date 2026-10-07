// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_LANE_ORDER,
  API_PROVIDER_PRESETS,
  MAX_API_MONTHLY_BUDGET_USD,
  apiErrorCode,
  normalizeApiBudget,
  resolveApiConnection,
  validateCustomApiEndpointInput,
  PROVIDER_RECHECK_INTERVAL_MS,
  buildSanitizedProviderDiagnostics,
  isIntelligentLane,
  mergeCheapProviderHealth,
  nextLaneAfterFailure,
  providerRecheckPlan,
  providerRetryAt,
  currentProviderOwner,
  displayTone,
  failoverAllowedForState,
  moveProvider,
  nextProviderAfterFailure,
  nextRecheckAt,
  normalizeProviderPriority,
  providerDisplayState,
  providersDueForRecheck,
  providerTransitions,
  redactDiagnostic,
  toProviderSettings,
  validateLocalEndpointInput,
  classifyEndpointHost
} from "../src/lib/providerPolicy.ts";
import type { ApiProviderConfig, ProviderId, ProviderStatus } from "../src/types.ts";

function status(provider: ProviderId, patch: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    provider,
    label: provider,
    state: "available",
    reason: "ready",
    installed: true,
    authenticated: true,
    available: true,
    enabled: true,
    failoverAllowed: false,
    capabilities: [],
    checkedAt: "2026-10-03T10:00:00.000Z",
    secretStored: false,
    ...patch
  };
}

test("normal job failures never qualify for provider hopping", () => {
  assert.equal(failoverAllowedForState("job_failed"), false);
  assert.equal(failoverAllowedForState("available"), false);
  for (const state of ["quota_limited", "auth_unavailable", "capacity_unavailable", "offline"] as const) {
    assert.equal(failoverAllowedForState(state), true, state);
  }
});

test("failover routes only provider-class failures to the next healthy provider", () => {
  const statuses = [
    status("codex"),
    status("claude", { state: "quota_limited", available: false }),
    status("api"),
    status("local"),
    status("local_control")
  ];
  const priority: ProviderId[] = ["codex", "claude", "api", "local", "local_control"];
  // Code-/Testfehler bleiben beim aktuellen Provider (fail closed, kein stiller Wechsel).
  assert.equal(nextProviderAfterFailure(statuses, priority, "codex", "job_failed"), null);
  // Quota bei Codex -> Claude ist selbst limitiert -> die API-Lane ist der naechste gesunde Provider.
  assert.equal(nextProviderAfterFailure(statuses, priority, "codex", "quota_limited"), "api");
  // Deaktivierte intelligente Provider werden nie gewaehlt; Local Control bleibt der deterministische Rest.
  const disabled = statuses.map((entry) =>
    entry.provider === "api" || entry.provider === "local" ? { ...entry, enabled: false } : entry
  );
  assert.equal(nextProviderAfterFailure(disabled, priority, "codex", "auth_unavailable"), "local_control");
  assert.equal(nextProviderAfterFailure(statuses, priority, "local", "offline"), "local_control");
});

test("priority is deterministic and Local Control remains last", () => {
  assert.deepEqual(normalizeProviderPriority(["local", "codex", "local"]), ["local", "codex", "claude", "api", "local_control"]);
  assert.deepEqual(normalizeProviderPriority(["local_control", "claude"]), ["claude", "codex", "api", "local", "local_control"]);
  assert.deepEqual(normalizeProviderPriority(undefined), ["codex", "claude", "api", "local", "local_control"]);
  assert.deepEqual(moveProvider(["codex", "claude", "api", "local", "local_control"], "local", "down"), [
    "codex",
    "claude",
    "api",
    "local",
    "local_control"
  ]);
  assert.deepEqual(moveProvider(["codex", "claude", "api", "local", "local_control"], "claude", "up"), [
    "claude",
    "codex",
    "api",
    "local",
    "local_control"
  ]);
  assert.deepEqual(moveProvider(["codex", "claude", "api", "local", "local_control"], "local_control", "up"), [
    "codex",
    "claude",
    "api",
    "local",
    "local_control"
  ]);
});

test("cards show truthful human-readable states", () => {
  assert.equal(providerDisplayState(status("codex", { installed: false, state: "unknown", reason: "not_installed" }), "codex"), "notInstalled");
  assert.equal(providerDisplayState(status("local", { installed: false, state: "unknown" }), "local"), "notConfigured");
  assert.equal(
    providerDisplayState(status("codex", { state: "auth_unavailable", authenticated: false, available: false }), "codex"),
    "connect"
  );
  // CLI hat Credentials, Provider lehnt sie im READY-Test ab -> erneute Anmeldung.
  assert.equal(providerDisplayState(status("claude", { state: "auth_unavailable", available: false }), "claude"), "reauth");
  assert.equal(providerDisplayState(status("codex", { state: "quota_limited", available: false }), "codex"), "quota");
  assert.equal(providerDisplayState(status("codex", { state: "offline", available: false }), "codex"), "offline");
  assert.equal(providerDisplayState(status("codex", { state: "job_failed", available: false }), "codex"), "unavailable");
  // Angemeldet heisst noch nicht verbunden: erst der READY-Test zeigt "Connected".
  assert.equal(providerDisplayState(status("codex", { state: "authenticated", available: false }), "codex"), "testRequired");
  assert.equal(providerDisplayState(status("codex"), "codex"), "connected");
  assert.equal(providerDisplayState(status("codex", { enabled: false }), "codex"), "disabled");
  assert.equal(providerDisplayState(status("codex"), "codex", true), "connecting");
  assert.equal(displayTone("connected"), "ok");
  assert.equal(displayTone("reauth"), "danger");
});

test("current owner follows the running job, then the first healthy provider", () => {
  const statuses = [status("codex", { available: false, state: "quota_limited" }), status("claude"), status("local_control")];
  assert.equal(currentProviderOwner(statuses, ["codex", "claude", "local", "local_control"]), "claude");
  assert.equal(currentProviderOwner(statuses, ["codex", "claude", "local", "local_control"], "codex_cli"), "codex");
  assert.equal(currentProviderOwner([], ["codex"]), "local_control");
});

test("provider transitions are recorded only on real state changes", () => {
  const before = [status("codex"), status("claude")];
  const after = [status("codex", { state: "quota_limited" }), status("claude")];
  assert.deepEqual(providerTransitions(before, after, "t"), [{ provider: "codex", from: "available", to: "quota_limited", at: "t" }]);
  assert.deepEqual(providerTransitions([], after, "t"), []);
});

test("quota, capacity and offline providers are re-checked sparingly", () => {
  const now = Date.parse("2026-10-03T10:20:00.000Z");
  const statuses = [
    status("codex", { state: "quota_limited", available: false }),
    status("claude", { state: "offline", available: false, checkedAt: "2026-10-03T10:15:00.000Z" }),
    status("local", { state: "job_failed", available: false }),
    status("local_control", { state: "offline" }),
    status("codex", { state: "quota_limited", enabled: false })
  ];
  assert.deepEqual(providersDueForRecheck(statuses, now), ["codex"]);
  // Stale Provider-Health wird spaetestens nach zehn Minuten erneuert.
  assert.equal(PROVIDER_RECHECK_INTERVAL_MS, 10 * 60 * 1000);
  assert.equal(nextRecheckAt(statuses[0]), "2026-10-03T10:10:00.000Z");
  assert.equal(nextRecheckAt(status("codex")), null);
});

test("local endpoint validation rejects credentials and injection-shaped URLs", () => {
  assert.equal(validateLocalEndpointInput("http://127.0.0.1:11434"), null);
  assert.equal(validateLocalEndpointInput("http://[::1]:1234/v1"), null);
  assert.equal(validateLocalEndpointInput("https://models.example.test/v1"), null);
  assert.equal(validateLocalEndpointInput(""), "missing");
  assert.equal(validateLocalEndpointInput("file:///tmp/model"), "scheme");
  assert.equal(validateLocalEndpointInput("javascript:alert(1)"), "scheme");
  assert.equal(validateLocalEndpointInput("http://user:secret@localhost:1234"), "credentials");
  assert.equal(validateLocalEndpointInput("http://localhost:1234/?token=secret"), "query");
  assert.equal(validateLocalEndpointInput("http://localhost:1234/#x"), "query");
  assert.equal(validateLocalEndpointInput("http://localhost:1234/\nHost: evil"), "invalid");
  assert.equal(validateLocalEndpointInput("http://localhost:1234 ; rm -rf /"), "invalid");
  assert.equal(validateLocalEndpointInput("http://@localhost:1234"), "credentials");
});

test("local endpoints allow plain HTTP only for exact loopback and block LAN/metadata by default", () => {
  for (const ok of [
    "http://127.0.0.1:11434",
    "http://127.8.9.10:1234",
    "http://localhost:1234/v1",
    "http://LOCALHOST.:1234",
    "http://[::1]:1234/v1",
    "http://2130706433:11434",
    "https://models.example.test/v1",
    "https://172.40.0.5:8000"
  ]) {
    assert.equal(validateLocalEndpointInput(ok), null, ok);
  }
  for (const blocked of [
    "http://169.254.169.254/latest/meta-data",
    "https://169.254.169.254/v1",
    "https://[fd00:ec2::254]/v1",
    "https://[::ffff:169.254.169.254]/v1",
    "https://[64:ff9b::a9fe:a9fe]/v1",
    "https://[2002:a9fe:a9fe::1]/v1",
    "https://[fe80::1]/v1",
    "http://10.0.0.5:8000",
    "https://172.16.0.1",
    "https://192.168.1.20:11434",
    "https://100.64.1.1",
    "https://[fd12:3456::1]:1234",
    "https://0.0.0.0:11434",
    "https://224.0.0.1",
    "https://255.255.255.255",
    "https://[::]/v1",
    "https://[ff02::1]/v1",
    "http://studio.local:1234",
    "https://metadata.google.internal/computeMetadata/v1",
    "https://router.home.arpa",
    "https://ollama:11434",
    "https://foo.localhost",
    "https://0xa9fea9fe/",
    "https://2852039166/",
    "https://168.63.129.16/",
    "https://100.100.100.200/"
  ]) {
    assert.equal(validateLocalEndpointInput(blocked), "blocked_network", blocked);
  }
  assert.equal(validateLocalEndpointInput("http://models.example.test/v1"), "https_required");
  assert.equal(validateLocalEndpointInput("http://172.40.0.5:8000"), "https_required");
});

test("endpoint host classification mirrors the Rust guard", () => {
  assert.equal(classifyEndpointHost("127.0.0.1"), "loopback");
  assert.equal(classifyEndpointHost("[::1]"), "loopback");
  assert.equal(classifyEndpointHost("[::ffff:7f00:1]"), "loopback");
  assert.equal(classifyEndpointHost("localhost"), "loopback");
  assert.equal(classifyEndpointHost("169.254.169.254"), "blocked");
  assert.equal(classifyEndpointHost("[fd00:ec2::254]"), "blocked");
  assert.equal(classifyEndpointHost("[2001:db8::1]"), "blocked");
  assert.equal(classifyEndpointHost("[2002:c0a8:101::1]"), "blocked");
  assert.equal(classifyEndpointHost("10.1.2.3"), "private");
  assert.equal(classifyEndpointHost("[::ffff:a00:1]"), "private");
  assert.equal(classifyEndpointHost("1.1.1.1"), "public");
  assert.equal(classifyEndpointHost("[2606:4700::1111]"), "public");
  assert.equal(classifyEndpointHost("[64:ff9b::101:101]"), "public");
  assert.equal(classifyEndpointHost("gateway.example.com"), "public");
});

test("API provider presets are remote HTTPS endpoints and keep EU routing explicit", () => {
  for (const preset of Object.values(API_PROVIDER_PRESETS)) {
    const url = new URL(preset.baseUrl);
    assert.equal(url.protocol, "https:");
    assert.ok(url.hostname);
  }
  assert.equal(API_PROVIDER_PRESETS.openrouter_eu.baseUrl, "https://eu.openrouter.ai/api/v1");
});

test("provider settings sent to Rust never contain secrets or the fallback toggle", () => {
  const settings = toProviderSettings(
    ["codex", "local_control"],
    {
      kind: "open_ai_compatible",
      baseUrl: "  http://127.0.0.1:8000/v1  ",
      model: " qwen "
    },
    [{
      id: "api-1",
      label: " Primary ",
      preset: "openrouter_eu",
      baseUrl: "  ",
      model: " openai/gpt-test ",
      effort: "high",
      mode: "auto",
      capabilities: ["coding"],
      enabled: true,
      monthlyBudgetUsd: 12.345
    }]
  );
  assert.deepEqual(settings, {
    disabledProviders: ["codex"],
    localProvider: { kind: "open_ai_compatible", baseUrl: "http://127.0.0.1:8000/v1", model: "qwen" },
    apiProviders: [{
      id: "api-1",
      label: "Primary",
      preset: "openrouter_eu",
      baseUrl: "",
      model: "openai/gpt-test",
      effort: "high",
      mode: "auto",
      capabilities: ["coding"],
      enabled: true,
      monthlyBudgetUsd: 12.35
    }]
  });
  assert.equal(JSON.stringify(settings).toLowerCase().includes("key"), false);
});

test("copied diagnostics redact credentials and personal identifiers", () => {
  const leaky = status("codex", {
    state: "auth_unavailable",
    reason: "login_failed",
    version: "codex-cli 0.145.0 /Users/alice/.local/bin/codex",
    detail:
      "Bearer abc.def.ghi oauth-secretvalue sk-live1234567890abcdef user@example.com " +
      "https://auth.openai.com/oauth/authorize?state=abc123 api_key=plainvalue C:\\Users\\bob\\.codex " +
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig"
  });
  const diagnostics = buildSanitizedProviderDiagnostics([leaky], "2.0.0");
  for (const leaked of [
    "abc.def.ghi",
    "secretvalue",
    "sk-live1234567890abcdef",
    "user@example.com",
    "alice",
    "bob",
    "abc123",
    "plainvalue",
    "eyJhbGciOiJIUzI1NiJ9"
  ]) {
    assert.equal(diagnostics.includes(leaked), false, leaked);
  }
  assert.match(diagnostics, /reason=login_failed/);
  assert.ok(redactDiagnostic("x".repeat(1000)).length <= 400);
});

test("provider reset hints become exact retry times anchored at the provider check", () => {
  const at = (retryHint: string) => providerRetryAt(status("codex", { state: "quota_limited", retryHint }));
  assert.equal(at("resets in 2h 30m"), "2026-10-03T12:30:00.000Z");
  assert.equal(at("try again in 45 minutes"), "2026-10-03T10:45:00.000Z");
  assert.equal(at("resets at 2026-10-03T13:00:00Z"), "2026-10-03T13:00:00.000Z");
  assert.equal(at("resets at 2026-10-03T09:00:00Z"), null, "past reset is not a target");
  const clock = at("Try again at 10:34 PM");
  assert.ok(clock);
  assert.equal(new Date(clock).getHours(), 22);
  assert.equal(new Date(clock).getMinutes(), 34);
  assert.equal(at("unit test failed at line 12"), null);
  assert.equal(providerRetryAt(status("codex")), null);
});

test("exact retry time drives a targeted recheck without drifting or looping", () => {
  const limited = status("codex", { state: "quota_limited", available: false, retryHint: "resets in 4 min" });
  assert.equal(nextRecheckAt(limited), "2026-10-03T10:04:00.000Z");
  // Ein billiger Check nach dem Reset verankert den Hinweis nicht neu und macht ihn nicht minuetlich faellig.
  const afterCheap = { ...limited, healthCheckedAt: "2026-10-03T10:05:00.000Z" };
  assert.equal(providerRetryAt(afterCheap), "2026-10-03T10:04:00.000Z");
  assert.equal(nextRecheckAt(afterCheap), "2026-10-03T10:15:00.000Z");
  assert.deepEqual(providersDueForRecheck([afterCheap], Date.parse("2026-10-03T10:06:00.000Z")), []);
});

test("cheap health checks never clear quota or downgrade proven availability", () => {
  const probe = status("codex", { state: "authenticated", available: false, checkedAt: "2026-10-03T10:10:00.000Z" });
  const limited = status("codex", { state: "quota_limited", available: false, retryHint: "resets in 2h" });
  const kept = mergeCheapProviderHealth(limited, probe);
  assert.equal(kept.state, "quota_limited");
  assert.equal(kept.checkedAt, limited.checkedAt);
  assert.equal(kept.healthCheckedAt, "2026-10-03T10:10:00.000Z");
  assert.equal(mergeCheapProviderHealth(status("codex"), probe).state, "available");
  const lost = status("codex", { state: "auth_unavailable", authenticated: false, available: false });
  assert.equal(mergeCheapProviderHealth(limited, lost).state, "auth_unavailable");
  // Re-Login erkannt: vorher abgelehnte Auth wird durch einen authentifizierten Check aufgehoben.
  assert.equal(mergeCheapProviderHealth(lost, probe).state, "authenticated");
});

test("recheck plan keeps costly READY probes for waiting work at the reset time", () => {
  const now = Date.parse("2026-10-03T10:12:00.000Z");
  const statuses = [
    status("codex", { state: "quota_limited", available: false, retryHint: "resets in 10 min" }),
    status("claude", { state: "quota_limited", available: false, retryHint: "resets in 2h" }),
    status("local", { checkedAt: "2026-10-03T09:00:00.000Z" }),
    status("local_control", { checkedAt: "2026-10-03T09:00:00.000Z" })
  ];
  assert.deepEqual(providerRecheckPlan(statuses, { nowMs: now, waitingWork: true }), {
    ready: ["codex"],
    cheap: ["claude", "local"]
  });
  // Ohne wartende Arbeit: nur billige Checks, nie Inferenz.
  assert.deepEqual(providerRecheckPlan(statuses, { nowMs: now, waitingWork: false }).ready, []);
  // Ohne Reset-Hinweis: READY-Test hoechstens alle 30 Minuten.
  const offline = [status("claude", { state: "offline", available: false })];
  assert.deepEqual(
    providerRecheckPlan(offline, { nowMs: now, waitingWork: true, lastReadyProbeAt: { claude: "2026-10-03T10:00:00.000Z" } }),
    { ready: [], cheap: ["claude"] }
  );
  assert.deepEqual(
    providerRecheckPlan(offline, { nowMs: Date.parse("2026-10-03T10:31:00.000Z"), waitingWork: true }).ready,
    ["claude"]
  );
});

test("remote orchestrator is the intelligent fallback before the deterministic substrate", () => {
  assert.deepEqual(AGENT_LANE_ORDER, ["codex", "claude", "api", "local", "remote_orchestrator", "local_control"]);
  assert.equal(isIntelligentLane("api"), true);
  assert.equal(isIntelligentLane("remote_orchestrator"), true);
  assert.equal(isIntelligentLane("local_control"), false);
  const limited = [
    status("codex", { state: "quota_limited", available: false }),
    status("claude", { state: "quota_limited", available: false }),
    status("api", { available: false, state: "offline" }),
    status("local", { available: false, state: "offline" })
  ];
  const priority: ProviderId[] = ["codex", "claude", "api", "local", "local_control"];
  assert.equal(nextLaneAfterFailure(limited, priority, "codex", "quota_limited", true), "remote_orchestrator");
  assert.equal(nextLaneAfterFailure(limited, priority, "codex", "quota_limited", false), "local_control");
  assert.equal(nextLaneAfterFailure([...limited.slice(0, 1), status("claude")], priority, "codex", "quota_limited", true), "claude");
  assert.equal(nextLaneAfterFailure(limited, priority, "remote_orchestrator", "offline", true), "local_control");
  assert.equal(nextLaneAfterFailure(limited, priority, "codex", "job_failed", true), null);
});

function apiSlot(id: string, patch: Partial<ApiProviderConfig> = {}): ApiProviderConfig {
  return {
    id,
    label: "",
    preset: "openai",
    baseUrl: "",
    model: "gpt-5.6-sol",
    effort: "auto",
    mode: "auto",
    capabilities: [],
    enabled: true,
    monthlyBudgetUsd: null,
    ...patch
  };
}

test("API routing: explicit and project choices fail closed instead of hopping to another paid provider", () => {
  const slots = [
    apiSlot("api-1", { preset: "deepseek", model: "deepseek-v4-flash", mode: "fallback" }),
    apiSlot("api-2", { preset: "mistral", model: "mistral-small-latest" }),
    apiSlot("api-3", { enabled: false })
  ];
  const projectPreferences = { "proj-a": "api-3", "proj-b": "api-1" };

  assert.deepEqual(resolveApiConnection(slots, { connectionId: "api-3" }), {
    connection: null,
    source: "explicit",
    block: "api_connection_unavailable"
  });
  assert.equal(resolveApiConnection(slots, { connectionId: "missing" }).block, "api_connection_unavailable");
  assert.deepEqual(resolveApiConnection(slots, { projectId: "proj-a", projectPreferences }), {
    connection: null,
    source: "project",
    block: "api_connection_unavailable"
  });
  assert.equal(resolveApiConnection(slots, { projectId: "proj-b", projectPreferences }).connection?.id, "api-1");
  // Auto: regulaerer Slot vor "fallback".
  const auto = resolveApiConnection(slots, { projectId: "proj-unset", projectPreferences });
  assert.equal(auto.source, "auto");
  assert.equal(auto.connection?.id, "api-2");
  assert.equal(resolveApiConnection([], {}).block, "api_not_configured");
  assert.equal(resolveApiConnection([apiSlot("api-9", { model: " " })], {}).block, "api_not_configured");
});

test("API routing: budgets block over-spent slots without silent provider switches", () => {
  const slots = [
    apiSlot("api-1", { monthlyBudgetUsd: 10 }),
    apiSlot("api-2", { preset: "mistral", model: "mistral-small-latest", monthlyBudgetUsd: 50 })
  ];
  // Explizite Wahl ueber Budget -> Stopp, kein Ausweichen auf api-2.
  assert.deepEqual(resolveApiConnection(slots, { connectionId: "api-1" }, { "api-1": 10 }), {
    connection: null,
    source: "explicit",
    block: "api_budget_exceeded"
  });
  // Auto nimmt nur Slots im Budget.
  assert.equal(resolveApiConnection(slots, {}, { "api-1": 12 }).connection?.id, "api-2");
  assert.equal(resolveApiConnection(slots, {}, { "api-1": 12, "api-2": 60 }).block, "api_budget_exceeded");
  assert.equal(resolveApiConnection(slots, {}, { "api-1": 9.99 }).connection?.id, "api-1");
});

test("API budgets normalize to a positive, capped amount", () => {
  assert.equal(normalizeApiBudget(null), null);
  assert.equal(normalizeApiBudget(""), null);
  assert.equal(normalizeApiBudget("0"), null);
  assert.equal(normalizeApiBudget(-3), null);
  assert.equal(normalizeApiBudget("12,5"), 12.5);
  assert.equal(normalizeApiBudget(1e9), MAX_API_MONTHLY_BUDGET_USD);
  assert.equal(normalizeApiBudget(Number.POSITIVE_INFINITY), null);
});

test("custom OpenAI-compatible endpoints must be https without credentials or query", () => {
  assert.equal(validateCustomApiEndpointInput("https://gateway.example.com/v1"), null);
  assert.equal(validateCustomApiEndpointInput("http://gateway.example.com/v1"), "https_required");
  assert.equal(validateCustomApiEndpointInput("https://user:pw@gateway.example.com/v1"), "credentials");
  assert.equal(validateCustomApiEndpointInput("https://gateway.example.com/v1?key=x"), "query");
  assert.equal(validateCustomApiEndpointInput(""), "missing");
  // API-Lane: nie Loopback, LAN oder Metadaten – auch nicht per HTTPS.
  for (const blocked of [
    "https://127.0.0.1:8443/v1",
    "https://localhost/v1",
    "http://localhost:1234/v1",
    "https://169.254.169.254/latest",
    "https://[fd00:ec2::254]/v1",
    "https://10.1.2.3/v1",
    "https://[fe80::1]/v1",
    "https://metadata.google.internal/v1"
  ]) {
    assert.equal(validateCustomApiEndpointInput(blocked), "blocked_network", blocked);
  }
});

test("API error codes are allow-listed and never echo raw messages or secrets", () => {
  const secret = "sk-ant-api03-EXAMPLEONLYSECRET0000";
  assert.equal(apiErrorCode("endpoint_auth_required"), "endpoint_auth_required");
  assert.equal(apiErrorCode("api_key_provider_mismatch"), "api_key_provider_mismatch");
  assert.equal(apiErrorCode("endpoint_blocked"), "endpoint_blocked");
  assert.equal(apiErrorCode(new Error("api_budget_exceeded")), "api_budget_exceeded");
  for (const raw of [new Error(`401 invalid key ${secret}`), `bad ${secret}`, { key: secret }, null]) {
    const code = apiErrorCode(raw);
    assert.equal(code, "api_request_failed");
    assert.equal(code.includes("EXAMPLEONLY"), false);
  }
});

test("diagnostic redaction also covers xAI and Z.AI key shapes", () => {
  const redacted = redactDiagnostic(
    "xai-EXAMPLEONLY00000000 and 0123456789abcdef0123456789abcdef.EXAMPLEONLY00000 and sk-ant-api03-EXAMPLEONLY0000"
  );
  assert.equal(redacted.includes("EXAMPLEONLY"), false, redacted);
});
