// Created by Nikolas Kato on 2026-06-28
// Lokaler Verlauf der Sync-Laeufe (echte Daten, sammelt ab dem ersten Lauf — KEIN Mock).
// Der Client schreibt nach jedem abgeschlossenen Lauf einen Datensatz in einen localStorage-Ring.
import type { SyncReport } from "../types";
import type { BarItem } from "../components/DiagramComponents";
import type { Lang } from "../i18n";

export interface RunRecord {
  finishedAt: string;
  startedAt: string;
  uploads: number;
  errors: number;
  warnings: number;
  relevantFiles: number;
  secretWarnings: number;
  dryRun: boolean;
}

const STORAGE_KEY = "katosync.runHistory.v1";
const MAX_ENTRIES = 60;

function read(): RunRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
  } catch {
    return [];
  }
}

export function loadRunHistory(): RunRecord[] {
  return read();
}

// Schreibt einen Lauf in den Ring; dedupliziert ueber finishedAt (gleicher Report -> kein Doppeleintrag).
export function recordRun(report: SyncReport): RunRecord[] {
  if (!report?.finishedAt) return read();
  const existing = read();
  if (existing.some((entry) => entry.finishedAt === report.finishedAt)) {
    return existing;
  }
  const record: RunRecord = {
    finishedAt: report.finishedAt,
    startedAt: report.startedAt,
    uploads: report.uploaded.length,
    errors: report.errors.length,
    warnings: report.warnings.length,
    relevantFiles: report.scan?.relevantFiles ?? 0,
    secretWarnings: report.scan?.secretWarnings ?? 0,
    dryRun: report.dryRun
  };
  const next = [...existing, record].slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage voll/blockiert -> Verlauf ist best-effort, kein harter Fehler.
  }
  return next;
}

export interface RunDay {
  day: string; // ISO-Datum (YYYY-MM-DD)
  label: string; // kurzes Tageslabel, lokalisiert (Intl)
  runs: number;
  uploads: number;
  errors: number;
}

// Aggregiert die letzten `days` Tage MIT mindestens einem Lauf (leere Tage werden nicht erfunden).
// Wochentags-Label lokalisiert ueber Intl (lang).
export function historyDays(records: RunRecord[], lang: Lang, days = 14): RunDay[] {
  const weekday = new Intl.DateTimeFormat(lang, { weekday: "short" });
  const byDay = new Map<string, RunDay>();
  for (const entry of records) {
    const date = new Date(entry.finishedAt);
    if (Number.isNaN(date.getTime())) continue;
    const day = entry.finishedAt.slice(0, 10);
    const current =
      byDay.get(day) ??
      ({ day, label: `${weekday.format(date)} ${date.getDate()}.`, runs: 0, uploads: 0, errors: 0 } as RunDay);
    current.runs += 1;
    current.uploads += entry.uploads;
    current.errors += entry.errors;
    byDay.set(day, current);
  }
  return Array.from(byDay.values())
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(-days);
}

// Verlaufs-Balken: Uploads pro Tag (Fehlertage in danger-tone). Leeres Array -> Komponente zeigt Leerzustand.
export function historyBars(records: RunRecord[], lang: Lang, days = 14): BarItem[] {
  return historyDays(records, lang, days).map((entry) => ({
    label: entry.label,
    value: entry.uploads,
    tone: entry.errors > 0 ? "danger" : "ok"
  }));
}
