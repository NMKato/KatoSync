// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSanitizedProviderDiagnostics,
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
  assert.equal(nextRecheckAt(statuses[0]), "2026-10-03T10:15:00.000Z");
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
