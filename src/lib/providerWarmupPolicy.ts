// Created by NMKato Solutions
// Reine, testbare Warm-up-Policy fuer Abo-Provider (Codex/ChatGPT-Login, Claude/claude.ai-Abo).
// Ein winziger READY-Prompt ohne Tools startet das rollierende Nutzungsfenster, bevor echte Arbeit
// ansteht. Hoechstens ein Warm-up je Provider und Cooldown-Fenster, nie waehrend Arbeit laeuft oder
// wartet. Der Rust-Service (provider_warmup.rs) prueft alle Gates erneut und ist autoritativ.
import type {
  AgentStartBlock,
  AgentSyncState,
  ProviderId,
  ProviderState,
  ProviderStatus,
  ProviderWarmupEntry,
  ProviderWarmupState
} from "../types";
import { agentWorkWaiting } from "./agentJobModel.ts";

// Spiegelt provider_warmup::WARMUP_COOLDOWN_SECS / WARMUP_RETRY_SECS.
export const PROVIDER_WARMUP_COOLDOWN_MS = (4 * 60 + 50) * 60 * 1000;
export const PROVIDER_WARMUP_RETRY_MS = 30 * 60 * 1000;

// Nur Abo-CLIs; Local Brain und Local Control werden nie aufgewaermt.
export const WARMUP_PROVIDERS: ProviderId[] = ["codex", "claude"];

// Ein Warm-up auf einem Provider mit Quota-/Kapazitaets-/Offline-Signal waere reine Verschwendung.
const WARMUP_STATES: ProviderState[] = ["available", "authenticated"];

// Startsperren, die echte Arbeit (Runner, Writer, Handoff, Orchestrator) anzeigen.
const WORK_BLOCKS: AgentStartBlock[] = ["runner_busy", "worktree_lease_active", "handoff_in_flight", "orchestrator_lease"];

export function emptyWarmupState(): ProviderWarmupState {
  return { schemaVersion: 1, codex: {}, claude: {} };
}

export function warmupEntry(state: ProviderWarmupState | null, provider: ProviderId): ProviderWarmupEntry {
  if (!state) return {};
  if (provider === "codex") return state.codex ?? {};
  if (provider === "claude") return state.claude ?? {};
  return {};
}

/** Eindeutig per Abo angemeldeter, aktivierter Codex/Claude ohne negatives Provider-Signal. */
export function warmupEligible(status: ProviderStatus | undefined): boolean {
  return Boolean(
    status &&
      WARMUP_PROVIDERS.includes(status.provider) &&
      status.enabled &&
      status.installed &&
      status.authenticated &&
      status.authKind === "subscription" &&
      WARMUP_STATES.includes(status.state)
  );
}

/** Laeuft oder wartet echte Arbeit? Dann kein Warm-up – der Job nutzt den Provider ohnehin. */
export function warmupSuppressedByWork(state: AgentSyncState | null, localBusy = false): boolean {
  if (localBusy) return true;
  if (!state) return true;
  if (WORK_BLOCKS.includes(state.startSafety.reason)) return true;
  if (state.jobs.some((job) => job.status === "running" || job.status === "verifying")) return true;
  return agentWorkWaiting(state);
}

const ms = (value: string | null | undefined) => {
  const parsed = Date.parse(value ?? "");
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Zeitpunkt, ab dem der Provider wieder aufgewaermt werden darf. Zaehlt den persistierten
 * Warm-up-Erfolg, einen Fehlversuch (Backoff) und einen READY-Test dieser Sitzung (auch er startet
 * das Fenster). Zeitstempel weit in der Zukunft (Uhrensprung) werden wie in Rust ignoriert.
 */
export function nextWarmupAt(
  entry: ProviderWarmupEntry,
  status: ProviderStatus | undefined,
  nowMs: number
): number {
  const bounded = (value: number | null, window: number) =>
    value === null || value > nowMs + window ? null : Math.min(value, nowMs) + window;
  const candidates = [
    bounded(ms(entry.lastSuccessAt), PROVIDER_WARMUP_COOLDOWN_MS),
    bounded(ms(status?.lastSuccessAt), PROVIDER_WARMUP_COOLDOWN_MS),
    bounded(ms(entry.lastAttemptAt), PROVIDER_WARMUP_RETRY_MS)
  ].filter((value): value is number => value !== null);
  return candidates.length ? Math.max(...candidates) : nowMs;
}

export type WarmupSkipReason = "disabled" | "state_pending" | "busy" | "in_flight" | "none_eligible" | "cooldown";

export interface ProviderWarmupPlan {
  provider: ProviderId | null;
  reason: WarmupSkipReason | "due";
}

/**
 * Waehlt hoechstens EINEN faelligen Provider (Prioritaetsreihenfolge der Statusliste). Warm-ups
 * laufen nacheinander, nie parallel und nie fuer Karten mit laufender Nutzeraktion.
 */
export function providerWarmupPlan(
  statuses: ProviderStatus[],
  options: {
    enabled: boolean;
    workBusy: boolean;
    inFlight: boolean;
    state: ProviderWarmupState | null;
    providerBusy?: Partial<Record<ProviderId, unknown>>;
    nowMs?: number;
  }
): ProviderWarmupPlan {
  if (!options.enabled) return { provider: null, reason: "disabled" };
  // Ohne geladene persistierte Zeitstempel nie aufwaermen (sonst Wiederholung nach Neustart).
  if (!options.state) return { provider: null, reason: "state_pending" };
  if (options.inFlight) return { provider: null, reason: "in_flight" };
  if (options.workBusy) return { provider: null, reason: "busy" };
  const nowMs = options.nowMs ?? Date.now();
  const eligible = statuses.filter((status) => warmupEligible(status) && !options.providerBusy?.[status.provider]);
  if (!eligible.length) return { provider: null, reason: "none_eligible" };
  const due = eligible.find((status) => nextWarmupAt(warmupEntry(options.state, status.provider), status, nowMs) <= nowMs);
  return due ? { provider: due.provider, reason: "due" } : { provider: null, reason: "cooldown" };
}
