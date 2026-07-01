// Created by Nikolas Kato on 2026-06-28
// Daten-Adapter fuer das Dashboard-Cockpit: wandelt echte ViewModel-Daten in die Prop-Shapes
// der Diagramm-Bausteine (DiagramComponents.tsx). KEINE Mock-Daten — nur echte vm-Felder.
import type {
  ActionPlan,
  Briefing,
  BriefingPriority,
  CodexEvent,
  ScanSummary,
  ScheduleConfig,
  SyncReport,
  Weekday
} from "../types";
import type { BarItem, KpiItem, Segment, StatusItem, TimelineItem, Tone } from "../components/DiagramComponents";
import type { Lang, TFunc } from "../i18n";

// ===== Aufgaben-Buckets (Task-Ebene: Offen / Ausgefuehrt / Erledigt / Problem) =====
export interface TaskBuckets {
  offen: number;
  ausgefuehrt: number;
  erledigt: number;
  aufgeschoben: number; // deferred = vom Executor uebersprungen, laeuft spaeter erneut (KEIN Fehler)
  problem: number; // rejected + failed
  total: number;
}

export function taskBuckets(plans: ActionPlan[]): TaskBuckets {
  const buckets: TaskBuckets = {
    offen: 0,
    ausgefuehrt: 0,
    erledigt: 0,
    aufgeschoben: 0,
    problem: 0,
    total: 0
  };
  for (const plan of plans) {
    for (const task of plan.tasks) {
      buckets.total += 1;
      switch (task.status) {
        case "pending":
        case "queued":
          buckets.offen += 1;
          break;
        case "running":
        case "executed":
          buckets.ausgefuehrt += 1;
          break;
        case "completed":
          buckets.erledigt += 1;
          break;
        case "deferred":
          buckets.aufgeschoben += 1;
          break;
        case "rejected":
        case "failed":
          buckets.problem += 1;
          break;
        default:
          buckets.offen += 1;
      }
    }
  }
  return buckets;
}

export function taskDonut(buckets: TaskBuckets, t: TFunc): Segment[] {
  return [
    { label: t("tasks.open"), value: buckets.offen, tone: "info" },
    { label: t("tasks.executed"), value: buckets.ausgefuehrt, tone: "brand" },
    { label: t("tasks.done"), value: buckets.erledigt, tone: "ok" },
    { label: t("tasks.deferred"), value: buckets.aufgeschoben, tone: "warn" },
    { label: t("tasks.problem"), value: buckets.problem, tone: "danger" }
  ];
}

export function taskKpis(buckets: TaskBuckets, dailyCount: number, t: TFunc): KpiItem[] {
  return [
    { label: t("tasks.open"), value: buckets.offen, tone: "info" },
    { label: t("tasks.executed"), value: buckets.ausgefuehrt, tone: "brand" },
    { label: t("tasks.done"), value: buckets.erledigt, tone: "ok" },
    { label: t("tasks.todayDone"), value: dailyCount, tone: "ok" }
  ];
}

// ===== Letzter Lauf =====
export function formatDuration(startedAt?: string | null, finishedAt?: string | null): string {
  if (!startedAt || !finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function lastRunKpis(report: SyncReport | null, t: TFunc): KpiItem[] {
  if (!report) return [];
  return [
    { label: t("lastRun.duration"), value: formatDuration(report.startedAt, report.finishedAt), tone: "info" },
    { label: report.dryRun ? t("lastRun.checked") : t("lastRun.uploads"), value: report.uploaded.length, tone: "ok" },
    { label: t("lastRun.errors"), value: report.errors.length, tone: report.errors.length ? "danger" : "ok" },
    { label: t("lastRun.warnings"), value: report.warnings.length, tone: report.warnings.length ? "warn" : "ok" }
  ];
}

export function uploadDonut(report: SyncReport | null, t: TFunc): Segment[] {
  if (!report || !report.uploaded.length) return [];
  const ok = report.uploaded.filter((u) => u.success).length;
  const failed = report.uploaded.length - ok;
  const segments: Segment[] = [{ label: t("upload.success"), value: ok, tone: "ok" }];
  if (failed > 0) segments.push({ label: t("upload.failed"), value: failed, tone: "danger" });
  return segments;
}

// ===== Scan nach Kategorie =====
export function scanBars(scan: ScanSummary | null, t: TFunc): BarItem[] {
  if (!scan) return [];
  const counts = new Map<string, number>();
  for (const finding of scan.findings) {
    if (finding.skipped) continue;
    const key = finding.category || t("cockpit.scan.other");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value, tone: "brand" as Tone }));
}

// ===== Codex-Live-Feed -> Timeline =====
function codexEventTone(event: CodexEvent): Tone {
  const haystack = `${event.label} ${event.text}`.toLowerCase();
  if (/(fehl|error|failed|abbruch)/.test(haystack)) return "danger";
  if (/(fertig|done|complete|erfolg|committed|gepusht)/.test(haystack)) return "ok";
  return "info";
}

// Maschinen-Event-Label (item.started, exec_command, tool_use …) -> Klartext-Schritt in Usersprache.
// Deckt Codex- (item/turn/thread.*) und Claude-Events (assistant/tool_use/result/system) ab.
export function codexPhaseLabel(label: string): string {
  const l = (label || "").toLowerCase();
  if (/(error|fail|abbruch)/.test(l)) return "Fehler";
  if (l.includes("turn.completed") || l === "result") return "Fertig";
  if (/(thread\.started|turn\.started|task_started)/.test(l) || l === "system") return "Startet";
  if (l.includes("file_change") || /(patch|apply)/.test(l)) return "Datei geändert";
  if (l.includes("command_execution") || /(exec|command)/.test(l)) return "Befehl";
  if (l.includes("web_search") || l.includes("search")) return "Websuche";
  if (l.includes("reasoning")) return "Denkt nach";
  if (/(mcp|tool_use|tool_call|tool)/.test(l)) return "Connector/Tool";
  if (/(assistant|agent_message|message)/.test(l)) return "Überlegt";
  if (l.includes("item.completed")) return "Schritt fertig";
  if (l.includes("item.started")) return "Arbeitet …";
  return "Schritt";
}

// Aktueller Klartext-Schritt fuers Statusband: juengstes Event mit echtem Text, sonst Phasen-Label.
export function codexCurrentStep(events: CodexEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const txt = (events[i].text ?? "").trim();
    if (txt) return txt.length > 140 ? `${txt.slice(0, 140)}…` : txt;
  }
  const last = events[events.length - 1];
  return last ? codexPhaseLabel(last.label) : "";
}

export function codexTimeline(events: CodexEvent[], limit = 6): TimelineItem[] {
  return events.slice(-limit).map((event) => {
    const text = (event.text ?? "").trim();
    const phase = codexPhaseLabel(event.label);
    const label = text ? `${phase} — ${text.slice(0, 80)}` : phase;
    return { time: `#${event.seq}`, label, state: codexEventTone(event) };
  });
}

// ===== Neue Briefings ("Was kam neu rein") =====
function priorityTone(priority: BriefingPriority): Tone {
  switch (priority) {
    case "critical":
      return "danger";
    case "high":
      return "warn";
    default:
      return "info";
  }
}

function shortWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return sameDay
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
    : `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.`;
}

export function newBriefingItems(briefings: Briefing[], t: TFunc, limit = 6): StatusItem[] {
  return briefings
    .filter((briefing) => !briefing.archivedAt && briefing.status === "new")
    .slice(0, limit)
    .map((briefing) => ({
      label: briefing.title || t("cockpit.newIn.untitled"),
      state: priorityTone(briefing.priority),
      note: `${briefing.agentName || briefing.source}${briefing.createdAt ? ` · ${shortWhen(briefing.createdAt)}` : ""}`
    }));
}

// ===== Naechster geplanter Lauf (client-seitig aus schedule + LaunchAgent) =====
const DAY_INDEX: Record<Weekday, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
};
export interface NextRunInfo {
  active: boolean;
  label: string;
}

export function computeNextRun(
  schedule: ScheduleConfig,
  launchInstalled: boolean,
  t: TFunc,
  lang: Lang
): NextRunInfo {
  if (!schedule.enabled || !launchInstalled) {
    return { active: false, label: t("next.none") };
  }
  const days = schedule.weekdays.map((d) => DAY_INDEX[d]);
  if (!days.length) {
    return { active: false, label: t("next.noWeekdays") };
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(schedule.hour)}:${pad(schedule.minute)}`;
  const now = new Date();
  for (let add = 0; add < 8; add += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + add);
    candidate.setHours(schedule.hour, schedule.minute, 0, 0);
    if (days.includes(candidate.getDay()) && candidate.getTime() > now.getTime()) {
      const prefix =
        add === 0
          ? t("next.today")
          : add === 1
            ? t("next.tomorrow")
            : new Intl.DateTimeFormat(lang, { weekday: "long" }).format(candidate);
      return { active: true, label: t("next.value", { day: prefix, time }) };
    }
  }
  return { active: true, label: t("next.scheduledAt", { time }) };
}
