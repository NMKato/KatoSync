// Created by NMKato Solutions
// Bounded, source-attributed operational evidence. No synthetic history or background I/O.
import type { AgentJobEvent, ProviderStatus, ProviderTransition, RegistryProject } from "../types";

export interface DailyEvidence {
  key: string;
  day: number;
  jobs: number;
  transitions: number;
}
export interface CommitEvidence {
  id: string;
  name: string;
  shortSha: string;
  at: string;
  state: "verified" | "observed";
}
export interface OperationalEvidence {
  days: DailyEvidence[];
  hasEvents: boolean;
  totalJobEvents: number;
  totalTransitions: number;
  commits: CommitEvidence[];
  providers: { available: number; total: number };
}

function localDayKey(value: Date): string {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

function eventDay(iso: string, now: number): string | null {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) && parsed <= now ? localDayKey(new Date(parsed)) : null;
}

export function buildOperationalEvidence(input: {
  events: readonly AgentJobEvent[];
  transitions: readonly ProviderTransition[];
  projects: readonly RegistryProject[];
  statuses: readonly ProviderStatus[];
  now?: Date;
}): OperationalEvidence {
  const now = input.now ?? new Date();
  const current = now.getTime();
  const days: DailyEvidence[] = [];
  const dates = new Map<string, DailyEvidence>();
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let remaining = 6; remaining >= 0; remaining -= 1) {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() - remaining);
    const row: DailyEvidence = { key: localDayKey(date), day: date.getDate(), jobs: 0, transitions: 0 };
    days.push(row);
    dates.set(row.key, row);
  }

  const seenEvents = new Set<string>();
  for (const event of input.events) {
    if (!event.id || seenEvents.has(event.id)) continue;
    seenEvents.add(event.id);
    const day = eventDay(event.at, current);
    if (day && dates.has(day)) dates.get(day)!.jobs += 1;
  }

  const seenTransitions = new Set<string>();
  for (const transition of input.transitions) {
    const identity = [transition.provider, transition.from, transition.to, transition.at].join("|");
    if (seenTransitions.has(identity)) continue;
    seenTransitions.add(identity);
    const day = eventDay(transition.at, current);
    if (day && dates.has(day)) dates.get(day)!.transitions += 1;
  }

  // A Git commit's author/committer date does not establish its remote push time.
  const commits: CommitEvidence[] = input.projects
    .filter((project) => project.scan?.headSha && project.scan?.headDate && Number.isFinite(Date.parse(project.scan.headDate)))
    .map((project) => ({
      id: project.id,
      name: project.name,
      shortSha: (project.scan?.headSha ?? "").slice(0, 8),
      at: project.scan!.headDate!,
      state: project.verification?.state === "verified"
        && project.verification.headSha === project.scan!.headSha ? "verified" as const : "observed" as const
    }))
    .filter((item) => Date.parse(item.at) <= current)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 4);

  const cloud = input.statuses.filter((state) => state.provider === "codex" || state.provider === "claude");
  return {
    days,
    hasEvents: days.some((day) => day.jobs > 0 || day.transitions > 0),
    totalJobEvents: days.reduce((sum, day) => sum + day.jobs, 0),
    totalTransitions: days.reduce((sum, day) => sum + day.transitions, 0),
    commits,
    providers: {
      available: cloud.filter((state) => state.enabled && state.installed && state.authenticated && state.available).length,
      total: 2
    }
  };
}
