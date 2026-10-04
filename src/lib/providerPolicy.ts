// Created by NMKato Solutions
// Reine, testbare Agent-Sync-Policy: Reihenfolge, Failover-Klassen, Kartenzustand, Re-Checks,
// Endpoint-Validierung und redigierte Diagnosen. Keine Seiteneffekte, keine Secrets.
import type {
  AgentLaneId,
  LocalProviderConfig,
  LocalProviderKind,
  ProviderDisplayState,
  ProviderId,
  ProviderSettings,
  ProviderState,
  ProviderStatus,
  ProviderTransition
} from "../types";

export const DEFAULT_PROVIDER_PRIORITY: ProviderId[] = ["codex", "claude", "local", "local_control"];

// Provider melden Kontingent-/Kapazitaetsgrenzen selten mit Reset-Zeit. Spaetestens nach zehn
// Minuten wird der billige Auth-/Netzstatus erneuert; READY-Probes bleiben bedarfsgebunden.
export const PROVIDER_RECHECK_INTERVAL_MS = 10 * 60 * 1000;

export const LOCAL_PRESETS: Record<Exclude<LocalProviderKind, "open_ai_compatible">, string> = {
  ollama: "http://127.0.0.1:11434",
  lm_studio: "http://127.0.0.1:1234"
};

// Offizielle Installationsanleitungen der Provider (keine Downloads durch KatoSync).
export const PROVIDER_INSTALL_GUIDES: Partial<Record<ProviderId, string>> = {
  codex: "https://learn.chatgpt.com/docs/codex/cli",
  claude: "https://code.claude.com/docs/en/setup"
};

const FAILOVER_STATES: ProviderState[] = [
  "quota_limited",
  "auth_unavailable",
  "capacity_unavailable",
  "offline",
  "unknown"
];

const RECHECK_STATES: ProviderState[] = ["quota_limited", "capacity_unavailable", "offline"];

export function normalizeProviderPriority(value: ProviderId[] | undefined): ProviderId[] {
  const result: ProviderId[] = [];
  for (const provider of [...(value ?? []), ...DEFAULT_PROVIDER_PRIORITY]) {
    if (DEFAULT_PROVIDER_PRIORITY.includes(provider) && !result.includes(provider)) result.push(provider);
  }
  // Der deterministische Pfad bleibt unabhaengig von Nutzerreihenfolgen letzter Fallback.
  return [...result.filter((provider) => provider !== "local_control"), "local_control"];
}

export function moveProvider(priority: ProviderId[], provider: ProviderId, direction: "up" | "down"): ProviderId[] {
  const normalized = normalizeProviderPriority(priority);
  const index = normalized.indexOf(provider);
  const target = direction === "up" ? index - 1 : index + 1;
  // local_control ist fix der letzte Platz und selbst nicht verschiebbar.
  if (provider === "local_control" || index < 0 || target < 0 || target >= normalized.length - 1) {
    return normalized;
  }
  const next = [...normalized];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function toProviderSettings(
  disabledProviders: ProviderId[],
  localProvider: LocalProviderConfig
): ProviderSettings {
  return {
    disabledProviders: disabledProviders.filter((provider) => provider !== "local_control"),
    localProvider: {
      kind: localProvider.kind,
      baseUrl: localProvider.baseUrl.trim(),
      model: localProvider.model.trim()
    }
  };
}

// Nur Auth-/Quota-/Kapazitaets-/Verfuegbarkeitsklassen duerfen zum naechsten Provider fuehren.
export function failoverAllowedForState(state: ProviderState): boolean {
  return FAILOVER_STATES.includes(state);
}

/**
 * Bestimmt nach einem Fehlschlag den naechsten Provider. Gewoehnliche Job-/Code-/Testfehler
 * (`job_failed`) liefern `null`: der Job bleibt beim aktuellen Provider und schlaegt sichtbar fehl.
 */
export function nextProviderAfterFailure(
  statuses: ProviderStatus[],
  priority: ProviderId[],
  current: ProviderId,
  failure: ProviderState
): ProviderId | null {
  if (!failoverAllowedForState(failure)) return null;
  const order = normalizeProviderPriority(priority);
  const start = order.indexOf(current);
  for (const candidate of order.slice(start + 1)) {
    if (candidate === "local_control") return "local_control";
    const status = statuses.find((entry) => entry.provider === candidate);
    if (status?.enabled && status.available) return candidate;
  }
  return "local_control";
}

export function providerDisplayState(
  status: ProviderStatus | undefined,
  provider: ProviderId,
  connecting = false
): ProviderDisplayState {
  if (connecting) return "connecting";
  if (!status) return provider === "local" ? "notConfigured" : "connect";
  if (!status.installed) return provider === "local" ? "notConfigured" : "notInstalled";
  if (!status.enabled) return "disabled";
  switch (status.state) {
    case "available":
      return "connected";
    case "authenticated":
      return "testRequired";
    case "auth_unavailable":
      // CLI hat Credentials, der Provider lehnt sie aber ab -> abgelaufen statt "nie verbunden".
      return status.authenticated || provider === "local" ? "reauth" : "connect";
    case "quota_limited":
      return "quota";
    case "offline":
      return "offline";
    case "installed":
      return "connect";
    default:
      return "unavailable";
  }
}

export function displayTone(state: ProviderDisplayState): "ok" | "warn" | "danger" | "neutral" {
  if (state === "connected") return "ok";
  if (state === "quota" || state === "testRequired" || state === "connecting") return "warn";
  if (state === "reauth" || state === "offline" || state === "unavailable") return "danger";
  return "neutral";
}

/** Letzter echter Statuskontakt: READY-Klassifikation oder billiger Auth-/Netz-Check. */
function lastHealthCheck(status: ProviderStatus): number {
  const classified = Date.parse(status.checkedAt);
  const cheap = Date.parse(status.healthCheckedAt ?? "");
  if (Number.isNaN(cheap)) return classified;
  return Number.isNaN(classified) ? cheap : Math.max(classified, cheap);
}

/** Provider, deren Kontingent/Kapazitaet/Erreichbarkeit nach Ablauf des Intervalls neu zu pruefen ist. */
export function providersDueForRecheck(
  statuses: ProviderStatus[],
  nowMs = Date.now(),
  intervalMs = PROVIDER_RECHECK_INTERVAL_MS
): ProviderId[] {
  return statuses
    .filter((status) => status.enabled && status.provider !== "local_control" && RECHECK_STATES.includes(status.state))
    .filter((status) => {
      const next = nextRecheckAt(status, intervalMs);
      return next === null || Date.parse(next) <= nowMs;
    })
    .map((status) => status.provider);
}

/**
 * Naechster gezielter Re-Check: spaetestens zehn Minuten nach dem letzten Kontakt, frueher genau
 * zum providerseitigen Reset-Zeitpunkt. Ein Reset, der vor dem letzten Kontakt lag, zaehlt nicht
 * mehr – sonst waere der Provider jede Minute erneut faellig.
 */
export function nextRecheckAt(status: ProviderStatus, intervalMs = PROVIDER_RECHECK_INTERVAL_MS): string | null {
  if (!status.enabled || !RECHECK_STATES.includes(status.state)) return null;
  const checked = lastHealthCheck(status);
  if (Number.isNaN(checked)) return null;
  const bounded = checked + intervalMs;
  const targeted = Date.parse(providerRetryAt(status) ?? "");
  const exact = !Number.isNaN(targeted) && targeted > checked ? targeted : Number.POSITIVE_INFINITY;
  return new Date(Math.min(bounded, exact)).toISOString();
}

const UNIT_MS: Array<[RegExp, number]> = [
  [/^(?:h|hr|hrs|hour|hours)$/, 3_600_000],
  [/^(?:m|min|mins|minute|minutes)$/, 60_000],
  [/^(?:s|sec|secs|second|seconds)$/, 1_000]
];

/**
 * Wertet nur den bereits redigierten, providerseitigen Retry-Hinweis aus (z. B. "try again at
 * 10:34 PM", "resets in 2h 30m", ISO-Zeitpunkt). Relative Angaben sind an `checkedAt` verankert –
 * dem Zeitpunkt, zu dem der Provider den Hinweis geliefert hat.
 */
export function providerRetryAt(status: ProviderStatus): string | null {
  const hint = status.retryHint?.trim();
  const checked = Date.parse(status.checkedAt);
  if (!hint || Number.isNaN(checked)) return null;

  const iso = hint.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/i)?.[0];
  if (iso) {
    const value = Date.parse(iso);
    return !Number.isNaN(value) && value > checked ? new Date(value).toISOString() : null;
  }

  const relative = hint.match(/\bin\s+((?:\d+\s*[a-z]+\s*)+)/i);
  if (relative) {
    let total = 0;
    for (const [, amount, unit] of relative[1].matchAll(/(\d+)\s*([a-z]+)/gi)) {
      const factor = UNIT_MS.find(([pattern]) => pattern.test(unit.toLowerCase()))?.[1];
      if (factor) total += Number(amount) * factor;
    }
    if (total > 0) return new Date(checked + total).toISOString();
  }

  const clock = hint.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?(?![\d:])/i);
  if (clock && (clock[2] !== undefined || clock[3] !== undefined)) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] ?? 0);
    const meridiem = clock[3]?.toLowerCase().replace(/\./g, "");
    if (hour > 23 || minute > 59 || (meridiem && hour > 12)) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    const value = new Date(checked);
    value.setHours(hour, minute, 0, 0);
    if (value.getTime() <= checked) value.setDate(value.getDate() + 1);
    return value.toISOString();
  }
  return null;
}

// Ohne Reset-Hinweis wird ein teurer READY-Test fuer wartende Arbeit hoechstens alle 30 Minuten wiederholt.
export const PROVIDER_READINESS_FALLBACK_MS = 30 * 60 * 1000;

// Zustaende, die ein billiger Auth-/Status-Check (ohne Inferenz) nicht widerlegen kann.
const READINESS_PROVEN_STATES: ProviderState[] = ["available", "quota_limited", "capacity_unavailable", "offline"];

/**
 * Fuehrt einen billigen Status-Check (ohne READY-Inferenz) in den bekannten Zustand ein. Negative
 * Signale (nicht installiert, deaktiviert, Auth weg, offline) und bewiesene Verfuegbarkeit werden
 * uebernommen; ein blosses "authentifiziert" hebt weder Quota/Kapazitaet/Offline auf noch stuft es
 * einen verfuegbaren Provider herab. `checkedAt` bleibt Anker fuer relative Retry-Hinweise.
 */
export function mergeCheapProviderHealth(current: ProviderStatus, probe: ProviderStatus): ProviderStatus {
  const negative =
    !probe.installed ||
    !probe.enabled ||
    probe.state === "auth_unavailable" ||
    probe.state === "offline";
  if (negative || probe.available || !READINESS_PROVEN_STATES.includes(current.state)) {
    return { ...probe, healthCheckedAt: probe.checkedAt };
  }
  return {
    ...current,
    installed: probe.installed,
    authenticated: probe.authenticated,
    version: probe.version ?? current.version,
    healthCheckedAt: probe.checkedAt
  };
}

export interface ProviderRecheckPlan {
  // Billiger Auth-/Netz-/Status-Check (alle 10 Minuten zulaessig).
  cheap: ProviderId[];
  // Teurer READY-/Inferenz-Test – nur fuer wartende Arbeit und nur zum Reset-Zeitpunkt.
  ready: ProviderId[];
}

/**
 * Plant die Provider-Re-Checks eines Timer-Ticks. Billige Checks halten jede Provider-Karte
 * hoechstens zehn Minuten alt; READY-Tests laufen nur, wenn Arbeit wartet und entweder der
 * gemeldete Reset erreicht ist oder (ohne Hinweis) der letzte READY-Test 30 Minuten zurueckliegt.
 */
export function providerRecheckPlan(
  statuses: ProviderStatus[],
  options: {
    nowMs?: number;
    waitingWork: boolean;
    lastReadyProbeAt?: Partial<Record<ProviderId, string>>;
    intervalMs?: number;
    readinessFallbackMs?: number;
  }
): ProviderRecheckPlan {
  const nowMs = options.nowMs ?? Date.now();
  const intervalMs = options.intervalMs ?? PROVIDER_RECHECK_INTERVAL_MS;
  const fallbackMs = options.readinessFallbackMs ?? PROVIDER_READINESS_FALLBACK_MS;
  const plan: ProviderRecheckPlan = { cheap: [], ready: [] };
  for (const status of statuses) {
    if (!status.enabled || status.provider === "local_control") continue;
    if (options.waitingWork && RECHECK_STATES.includes(status.state)) {
      const retry = Date.parse(providerRetryAt(status) ?? "");
      const lastReady = Date.parse(options.lastReadyProbeAt?.[status.provider] ?? status.checkedAt);
      const resetReached = !Number.isNaN(retry) && retry <= nowMs;
      const noHintFallback = Number.isNaN(retry) && (Number.isNaN(lastReady) || nowMs - lastReady >= fallbackMs);
      if (resetReached || noHintFallback) {
        plan.ready.push(status.provider);
        continue;
      }
    }
    const next = RECHECK_STATES.includes(status.state) ? Date.parse(nextRecheckAt(status, intervalMs) ?? "") : Number.NaN;
    const last = lastHealthCheck(status);
    const due = !Number.isNaN(next) ? next <= nowMs : Number.isNaN(last) || nowMs - last >= intervalMs;
    if (due) plan.cheap.push(status.provider);
  }
  return plan;
}

// ===== Agent-Lanes: intelligente Failover-Kette + deterministisches Substrat =====
export const AGENT_LANE_ORDER: AgentLaneId[] = ["codex", "claude", "local", "remote_orchestrator", "local_control"];

export function isIntelligentLane(lane: AgentLaneId): boolean {
  return lane !== "local_control";
}

/**
 * Naechste Lane nach einem failover-faehigen Fehler. Modell-Provider folgen der Nutzerprioritaet;
 * danach uebernimmt Remote Orchestrator + RDC (nur mit gueltiger Lease), zuletzt parkt Local
 * Control den Job deterministisch. Gewoehnliche Job-/Code-/Testfehler liefern `null`.
 */
export function nextLaneAfterFailure(
  statuses: ProviderStatus[],
  priority: ProviderId[],
  current: AgentLaneId,
  failure: ProviderState,
  remoteEligible: boolean
): AgentLaneId | null {
  if (!failoverAllowedForState(failure)) return null;
  const order: AgentLaneId[] = [
    ...normalizeProviderPriority(priority).filter((provider) => provider !== "local_control"),
    "remote_orchestrator",
    "local_control"
  ];
  for (const candidate of order.slice(order.indexOf(current) + 1)) {
    if (candidate === "local_control") return candidate;
    if (candidate === "remote_orchestrator") {
      if (remoteEligible) return candidate;
      continue;
    }
    const status = statuses.find((entry) => entry.provider === candidate);
    if (status?.enabled && status.available) return candidate;
  }
  return "local_control";
}

export type LocalEndpointError = "missing" | "invalid" | "scheme" | "host" | "credentials" | "query";

export function validateLocalEndpointInput(value: string): LocalEndpointError | null {
  const trimmed = value.trim();
  if (!trimmed) return "missing";
  if (trimmed.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(trimmed)) return "invalid";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "scheme";
  if (!url.hostname) return "host";
  if (url.username || url.password) return "credentials";
  if (url.search || url.hash || trimmed.includes("?") || trimmed.includes("#")) return "query";
  return null;
}

// Spiegelt die Rust-Redaction (provider_manager::redact) fuer alles, was in die Zwischenablage geht.
export function redactDiagnostic(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\b(?:sk|sess|oauth|token|rk|pk|ghp|gho|xox[a-z])[-_][A-Za-z0-9._-]{8,}/gi, "<redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <redacted>")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+/g, "<redacted-jwt>")
    .replace(
      /(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password)(["']?\s*[=:]\s*["']?)[^\s,;"'&]+/gi,
      "$1$2<redacted>"
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<email>")
    .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, "$1<redacted>@")
    .replace(/(https?:\/\/[^\s?#]+)\?\S*/gi, "$1?<redacted>")
    .replace(/\/(?:Users|home)\/[^/\s]+/gi, "/<home>")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "<home>")
    .slice(0, 400);
}

export function buildSanitizedProviderDiagnostics(statuses: ProviderStatus[], appVersion = ""): string {
  const header = `KatoSync Agent Sync diagnostics${appVersion ? ` ${appVersion}` : ""} @ ${new Date().toISOString()}`;
  const lines = statuses.map((status) =>
    [
      status.provider,
      `state=${status.state}`,
      `reason=${status.reason}`,
      `installed=${status.installed}`,
      `authenticated=${status.authenticated}`,
      `available=${status.available}`,
      `enabled=${status.enabled}`,
      `failoverAllowed=${status.failoverAllowed}`,
      `version=${redactDiagnostic(status.version ?? "-")}`,
      `scope=${status.endpointScope ?? "-"}`,
      `keyStored=${status.secretStored}`,
      `checkedAt=${status.checkedAt}`,
      `retry=${redactDiagnostic(status.retryHint ?? "-")}`,
      `detail=${redactDiagnostic(status.detail ?? "-")}`
    ].join(" ")
  );
  return [header, ...lines].join("\n");
}

export function providerTransitions(
  previous: ProviderStatus[],
  next: ProviderStatus[],
  now = new Date().toISOString()
): ProviderTransition[] {
  const before = new Map(previous.map((status) => [status.provider, status.state]));
  return next.flatMap((status) => {
    const from = before.get(status.provider);
    if (!from || from === status.state) return [];
    return [{ provider: status.provider, from, to: status.state, at: now }];
  });
}

export function mergeProviderStatus(
  current: ProviderStatus[],
  status: ProviderStatus,
  priority: ProviderId[]
): ProviderStatus[] {
  const order = normalizeProviderPriority(priority);
  return [...current.filter((entry) => entry.provider !== status.provider), status].sort(
    (a, b) => order.indexOf(a.provider) - order.indexOf(b.provider)
  );
}

export function currentProviderOwner(
  statuses: ProviderStatus[],
  priority: ProviderId[],
  runner?: string | null
): ProviderId {
  // Laeuft gerade ein Job, gehoert die Lane dem tatsaechlich ausfuehrenden Runner.
  if (runner === "codex_cli") return "codex";
  if (runner === "claude_cli") return "claude";
  return (
    normalizeProviderPriority(priority).find((provider) =>
      statuses.some((status) => status.provider === provider && status.enabled && status.available)
    ) ?? "local_control"
  );
}
