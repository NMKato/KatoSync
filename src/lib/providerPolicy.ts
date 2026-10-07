// Created by NMKato Solutions
// Reine, testbare Agent-Sync-Policy: Reihenfolge, Failover-Klassen, Kartenzustand, Re-Checks,
// Endpoint-Validierung und redigierte Diagnosen. Keine Seiteneffekte, keine Secrets.
import type {
  AgentLaneId,
  ApiProviderConfig,
  ApiProviderPreset,
  LocalProviderConfig,
  LocalProviderKind,
  ProviderDisplayState,
  ProviderId,
  ProviderSettings,
  ProviderState,
  ProviderStatus,
  ProviderTransition
} from "../types";

export const DEFAULT_PROVIDER_PRIORITY: ProviderId[] = ["codex", "claude", "api", "local", "local_control"];

export const API_PROVIDER_PRESETS: Record<Exclude<ApiProviderPreset, "custom_openai">, { label: string; baseUrl: string }> = {
  openai: { label: "OpenAI API", baseUrl: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic API", baseUrl: "https://api.anthropic.com/v1" },
  openrouter_global: { label: "OpenRouter Global", baseUrl: "https://openrouter.ai/api/v1" },
  openrouter_eu: { label: "OpenRouter EU", baseUrl: "https://eu.openrouter.ai/api/v1" },
  deepseek: { label: "DeepSeek API", baseUrl: "https://api.deepseek.com/v1" },
  mistral: { label: "Mistral API", baseUrl: "https://api.mistral.ai/v1" },
  xai: { label: "xAI API", baseUrl: "https://api.x.ai/v1" },
  zai: { label: "Z.AI / GLM API", baseUrl: "https://api.z.ai/api/paas/v4" }
};

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

// Obergrenze schuetzt vor Tippfehlern (z. B. 100000 statt 100). Ungueltig = kein Budget.
export const MAX_API_MONTHLY_BUDGET_USD = 50_000;

export function normalizeApiBudget(value: unknown): number | null {
  const amount = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(Math.min(amount, MAX_API_MONTHLY_BUDGET_USD) * 100) / 100;
}

export type ApiRouteBlock = "api_not_configured" | "api_connection_unavailable" | "api_budget_exceeded";

export interface ApiRouteDecision {
  connection: ApiProviderConfig | null;
  source: "explicit" | "project" | "auto" | null;
  block: ApiRouteBlock | null;
}

function routable(connection: ApiProviderConfig): boolean {
  return connection.enabled && connection.model.trim().length > 0;
}

/**
 * Waehlt genau einen API-Slot fuer einen Lauf. Fail-closed: Eine explizite oder projektbezogene
 * Wahl wird nie still auf einen anderen bezahlten Provider umgeleitet. Auto-Routing nimmt nur
 * Slots im Budget; "fallback"-Slots kommen erst, wenn kein regulaerer Slot verfuegbar ist.
 */
export function resolveApiConnection(
  connections: ApiProviderConfig[],
  options: { connectionId?: string | null; projectId?: string | null; projectPreferences?: Record<string, string> },
  monthSpendUsd: Record<string, number> = {}
): ApiRouteDecision {
  const overBudget = (connection: ApiProviderConfig) => {
    const budget = normalizeApiBudget(connection.monthlyBudgetUsd);
    return budget !== null && (monthSpendUsd[connection.id] ?? 0) >= budget;
  };
  const pinnedId = options.connectionId?.trim() || null;
  const projectId = options.projectId?.trim() || null;
  const preferredId = pinnedId ?? (projectId ? options.projectPreferences?.[projectId] ?? null : null);
  if (preferredId) {
    const source = pinnedId ? "explicit" : "project";
    const connection = connections.find((item) => item.id === preferredId) ?? null;
    if (!connection || !routable(connection)) return { connection: null, source, block: "api_connection_unavailable" };
    if (overBudget(connection)) return { connection: null, source, block: "api_budget_exceeded" };
    return { connection, source, block: null };
  }
  const candidates = connections.filter(routable);
  if (!candidates.length) return { connection: null, source: null, block: "api_not_configured" };
  const inBudget = candidates.filter((connection) => !overBudget(connection));
  if (!inBudget.length) return { connection: null, source: "auto", block: "api_budget_exceeded" };
  const connection = inBudget.find((item) => item.mode !== "fallback") ?? inBudget[0];
  return { connection, source: "auto", block: null };
}

export function toProviderSettings(
  disabledProviders: ProviderId[],
  localProvider: LocalProviderConfig,
  apiProviders: ApiProviderConfig[]
): ProviderSettings {
  return {
    disabledProviders: disabledProviders.filter((provider) => provider !== "local_control"),
    localProvider: {
      kind: localProvider.kind,
      baseUrl: localProvider.baseUrl.trim(),
      model: localProvider.model.trim()
    },
    apiProviders: apiProviders.map((connection) => ({
      id: connection.id,
      label: connection.label.trim(),
      preset: connection.preset,
      baseUrl: connection.baseUrl.trim(),
      model: connection.model.trim(),
      effort: connection.effort,
      mode: connection.mode,
      capabilities: [...connection.capabilities],
      enabled: connection.enabled,
      monthlyBudgetUsd: normalizeApiBudget(connection.monthlyBudgetUsd)
    }))
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
  if (!status) return provider === "local" || provider === "api" ? "notConfigured" : "connect";
  if (!status.installed) return provider === "local" || provider === "api" ? "notConfigured" : "notInstalled";
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
    authKind: probe.authKind ?? current.authKind,
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
export const AGENT_LANE_ORDER: AgentLaneId[] = ["codex", "claude", "api", "local", "remote_orchestrator", "local_control"];

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

export type LocalEndpointError =
  | "missing"
  | "invalid"
  | "scheme"
  | "host"
  | "credentials"
  | "query"
  | "blocked_network"
  | "https_required";

/**
 * Netzklasse eines Endpoint-Hosts. Spiegelt `endpoint_guard.rs` fuer sofortiges UI-Feedback;
 * verbindlich bleibt Rust (dort zusaetzlich mit Pruefung jeder DNS-Aufloesung).
 * - loopback: exakt `localhost`, 127.0.0.0/8, ::1 (HTTP erlaubt, nur Local-Lane)
 * - private: RFC1918, CGNAT, ULA, LAN-Namen (.local, .lan, .internal, einzelne Labels ...)
 * - blocked: Link-Local, Cloud-Metadaten, Multicast, Broadcast, unspezifiziert, reserviert
 * LAN-Endpunkte sind im Release ohne Freischaltmoeglichkeit gesperrt.
 */
export type EndpointHostClass = "loopback" | "private" | "blocked" | "public";

const LAN_SUFFIXES = [".local", ".lan", ".home", ".home.arpa", ".internal", ".intranet", ".corp", ".localdomain", ".localhost"];

function classifyIPv4(octets: number[]): EndpointHostClass {
  const [a, b, c] = octets;
  const ip = octets.join(".");
  if (a === 127) return "loopback";
  if (
    ip === "168.63.129.16" ||
    ip === "100.100.100.200" ||
    a === 0 ||
    (a === 169 && b === 254) ||
    a >= 224 ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b & 0xfe) === 18)
  ) {
    return "blocked";
  }
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && (b & 0xc0) === 64)) {
    return "private";
  }
  return "public";
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((value) => value <= 255) ? octets : null;
}

function parseIPv6(host: string): number[] | null {
  if (!host.startsWith("[") || !host.endsWith("]")) return null;
  const body = host.slice(1, -1).toLowerCase();
  const halves = body.split("::");
  if (halves.length > 2) return null;
  const groups = (value: string) => (value ? value.split(":") : []);
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill("0"), ...tail];
  if (all.length !== 8 || !all.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return all.map((group) => parseInt(group, 16));
}

function embeddedV4(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function classifyIPv6(seg: number[]): EndpointHostClass {
  const zeroPrefix = seg.slice(0, 5).every((value) => value === 0);
  if (zeroPrefix && seg[5] === 0 && seg[6] === 0 && seg[7] === 1) return "loopback";
  // AWS IMDS IPv6 fd00:ec2::254
  if (seg[0] === 0xfd00 && seg[1] === 0x0ec2 && seg.slice(2, 7).every((value) => value === 0) && seg[7] === 0x254) {
    return "blocked";
  }
  if (zeroPrefix && seg[5] === 0xffff) return classifyIPv4(embeddedV4(seg[6], seg[7]));
  if (zeroPrefix && seg[5] === 0) return "blocked";
  if (seg[0] === 0x64 && seg[1] === 0xff9b && seg.slice(2, 6).every((value) => value === 0)) {
    return classifyIPv4(embeddedV4(seg[6], seg[7]));
  }
  if (seg[0] === 0x2002) return classifyIPv4(embeddedV4(seg[1], seg[2])) === "public" ? "public" : "blocked";
  if ((seg[0] & 0xfe00) === 0xfc00) return "private";
  const globalUnicast = (seg[0] & 0xe000) === 0x2000;
  const special =
    (seg[0] === 0x2001 && seg[1] < 0x0200) || (seg[0] === 0x2001 && seg[1] === 0x0db8) || (seg[0] & 0xfff0) === 0x3ff0;
  return globalUnicast && !special ? "public" : "blocked";
}

/** Klassifiziert den bereits per WHATWG-URL kanonisierten Hostnamen. */
export function classifyEndpointHost(hostname: string): EndpointHostClass {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const v4 = parseIPv4(host);
  if (v4) return classifyIPv4(v4);
  if (host.startsWith("[")) {
    const v6 = parseIPv6(host);
    return v6 ? classifyIPv6(v6) : "blocked";
  }
  if (host === "localhost") return "loopback";
  if (!host.includes(".") || LAN_SUFFIXES.some((suffix) => host.endsWith(suffix))) return "private";
  return "public";
}

function endpointSyntaxError(value: string): { error: LocalEndpointError } | { url: URL } {
  const trimmed = value.trim();
  if (!trimmed) return { error: "missing" };
  if (trimmed.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(trimmed)) return { error: "invalid" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "scheme" };
  if (!url.hostname) return { error: "host" };
  // Auch ein leeres `user@` ist ein Credential-Versuch.
  const authority = trimmed.split("://")[1]?.split(/[/?#]/)[0] ?? "";
  if (url.username || url.password || authority.includes("@")) return { error: "credentials" };
  if (url.search || url.hash || trimmed.includes("?") || trimmed.includes("#")) return { error: "query" };
  return { url };
}

/** Local-Lane: exaktes Loopback (HTTP/HTTPS) oder oeffentliches HTTPS. LAN/privat ist gesperrt. */
export function validateLocalEndpointInput(value: string): LocalEndpointError | null {
  const parsed = endpointSyntaxError(value);
  if ("error" in parsed) return parsed.error;
  const hostClass = classifyEndpointHost(parsed.url.hostname);
  if (hostClass === "loopback") return null;
  if (hostClass !== "public") return "blocked_network";
  return parsed.url.protocol === "https:" ? null : "https_required";
}

export type ApiEndpointError = LocalEndpointError;

/** Custom OpenAI-compatible API-Endpunkte: ausschliesslich oeffentliches HTTPS, nie Loopback/LAN. */
export function validateCustomApiEndpointInput(value: string): ApiEndpointError | null {
  const parsed = endpointSyntaxError(value);
  if ("error" in parsed) return parsed.error;
  if (classifyEndpointHost(parsed.url.hostname) !== "public") return "blocked_network";
  return parsed.url.protocol === "https:" ? null : "https_required";
}

// Fehlercodes, die die API-Setup-UI uebersetzt. Alles andere wird generisch, nie roh angezeigt.
const API_ERROR_CODES = new Set<string>([
  "not_configured",
  "invalid_endpoint",
  "no_models",
  "model_missing",
  "endpoint_auth_required",
  "endpoint_error",
  "endpoint_invalid_response",
  "capability_failed",
  "insecure_remote_key",
  "endpoint_blocked",
  "secret_store_unavailable",
  "quota_limited",
  "capacity_limited",
  "offline",
  "timed_out",
  "api_key_provider_mismatch",
  "api_provider_choice_required",
  "api_key_invalid",
  "api_not_configured",
  "api_connection_unavailable",
  "api_budget_exceeded",
  "api_worker_unavailable"
]);

/**
 * Bildet beliebige Fehler (Tauri-Reason-Strings, Errors, Fremdtexte) auf einen bekannten Code ab.
 * Rohtexte werden nie durchgereicht, damit kein Key-Fragment in UI, Logs oder Toasts landet.
 */
export function apiErrorCode(error: unknown): string {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const code = raw.trim();
  return API_ERROR_CODES.has(code) ? code : "api_request_failed";
}

// Spiegelt die Rust-Redaction (provider_manager::redact) fuer alles, was in die Zwischenablage geht.
export function redactDiagnostic(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\b(?:sk|sess|oauth|token|rk|pk|ghp|gho|xai|xox[a-z])[-_][A-Za-z0-9._-]{8,}/gi, "<redacted>")
    .replace(/\b[0-9a-f]{32}\.[A-Za-z0-9]{16}\b/g, "<redacted>")
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
