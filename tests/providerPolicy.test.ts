// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_LANE_ORDER,
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
  validateLocalEndpointInput
} from "../src/lib/providerPolicy.ts";
import type { ProviderId, ProviderStatus } from "../src/types.ts";

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
    status("local"),
    status("local_control")
  ];
  const priority: ProviderId[] = ["codex", "claude", "local", "local_control"];
  // Code-/Testfehler bleiben beim aktuellen Provider (fail closed, kein stiller Wechsel).
  assert.equal(nextProviderAfterFailure(statuses, priority, "codex", "job_failed"), null);
  // Quota bei Codex -> Claude ist selbst limitiert -> naechster gesunder Provider ist Local.
  assert.equal(nextProviderAfterFailure(statuses, priority, "codex", "quota_limited"), "local");
  // Deaktivierte Provider werden nie gewaehlt; Local Control bleibt der deterministische Rest.
  const disabledLocal = statuses.map((entry) => (entry.provider === "local" ? { ...entry, enabled: false } : entry));
  assert.equal(nextProviderAfterFailure(disabledLocal, priority, "codex", "auth_unavailable"), "local_control");
  assert.equal(nextProviderAfterFailure(statuses, priority, "local", "offline"), "local_control");
});

test("priority is deterministic and Local Control remains last", () => {
  assert.deepEqual(normalizeProviderPriority(["local", "codex", "local"]), ["local", "codex", "claude", "local_control"]);
  assert.deepEqual(normalizeProviderPriority(["local_control", "claude"]), ["claude", "codex", "local", "local_control"]);
  assert.deepEqual(normalizeProviderPriority(undefined), ["codex", "claude", "local", "local_control"]);
  assert.deepEqual(moveProvider(["codex", "claude", "local", "local_control"], "local", "down"), [
    "codex",
    "claude",
    "local",
    "local_control"
  ]);
  assert.deepEqual(moveProvider(["codex", "claude", "local", "local_control"], "claude", "up"), [
    "claude",
    "codex",
    "local",
    "local_control"
  ]);
  assert.deepEqual(moveProvider(["codex", "claude", "local", "local_control"], "local_control", "up"), [
    "codex",
    "claude",
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
});

test("provider settings sent to Rust never contain secrets or the fallback toggle", () => {
  const settings = toProviderSettings(["codex", "local_control"], {
    kind: "open_ai_compatible",
    baseUrl: "  http://127.0.0.1:8000/v1  ",
    model: " qwen "
  });
  assert.deepEqual(settings, {
    disabledProviders: ["codex"],
    localProvider: { kind: "open_ai_compatible", baseUrl: "http://127.0.0.1:8000/v1", model: "qwen" }
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
  assert.deepEqual(AGENT_LANE_ORDER, ["codex", "claude", "local", "remote_orchestrator", "local_control"]);
  assert.equal(isIntelligentLane("remote_orchestrator"), true);
  assert.equal(isIntelligentLane("local_control"), false);
  const limited = [
    status("codex", { state: "quota_limited", available: false }),
    status("claude", { state: "quota_limited", available: false }),
    status("local", { available: false, state: "offline" })
  ];
  const priority: ProviderId[] = ["codex", "claude", "local", "local_control"];
  assert.equal(nextLaneAfterFailure(limited, priority, "codex", "quota_limited", true), "remote_orchestrator");
  assert.equal(nextLaneAfterFailure(limited, priority, "codex", "quota_limited", false), "local_control");
  assert.equal(nextLaneAfterFailure([...limited.slice(0, 1), status("claude")], priority, "codex", "quota_limited", true), "claude");
  assert.equal(nextLaneAfterFailure(limited, priority, "remote_orchestrator", "offline", true), "local_control");
  assert.equal(nextLaneAfterFailure(limited, priority, "codex", "job_failed", true), null);
});
