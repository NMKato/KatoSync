// Created by Nikolas Kato on 2026-06-28
// Gemeinsame SVG/CSS-Diagramm-Bausteine (Theme-Token, Light/Dark).
// Genutzt von RichMarkdown.tsx (Briefing-Format-Contract katosync:*) UND dem Dashboard-Cockpit.

import {
  Terminal,
  FileText,
  Search,
  Brain,
  Plug,
  CheckCircle2,
  AlertTriangle,
  Play,
  type LucideIcon
} from "lucide-react";

export type Tone = "brand" | "ok" | "warn" | "danger" | "info";

// Live-Feed: Schritt-Typ-Icons (nur genutzt, wenn TimelineItem.icon gesetzt ist -> Briefings unberührt).
const TL_ICONS: Record<string, LucideIcon> = {
  command: Terminal,
  file: FileText,
  search: Search,
  think: Brain,
  connector: Plug,
  done: CheckCircle2,
  error: AlertTriangle,
  start: Play
};

export interface KpiItem {
  label?: string;
  value?: string | number;
  delta?: string | number;
  tone?: Tone;
}
export interface Segment {
  label?: string;
  value?: number;
  tone?: Tone;
}
export interface BarItem {
  label?: string;
  value?: number;
  tone?: Tone;
}
export interface StatusItem {
  label?: string;
  state?: Tone;
  note?: string;
}
export interface TimelineItem {
  time?: string;
  label?: string;
  state?: Tone;
  icon?: string;
}

export const tone = (t?: string): Tone => {
  const allowed: Tone[] = ["brand", "ok", "warn", "danger", "info"];
  return allowed.includes(t as Tone) ? (t as Tone) : "brand";
};
export const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function KpiTiles({ title, items }: { title?: string; items?: KpiItem[] }) {
  const tiles = asArray<KpiItem>(items);
  return (
    <div className="katosync-block ks-kpi">
      {title ? <div className="ks-title">{title}</div> : null}
      <div className="ks-kpi-grid">
        {tiles.map((it, i) => (
          <div className={`ks-kpi-tile tone-${tone(it.tone)}`} key={i}>
            <span className="ks-kpi-value">{it.value ?? "—"}</span>
            <span className="ks-kpi-label">{it.label ?? ""}</span>
            {it.delta !== undefined ? <span className="ks-kpi-delta">{it.delta}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Donut({ title, segments }: { title?: string; segments?: Segment[] }) {
  const segs = asArray<Segment>(segments);
  const total = segs.reduce((sum, s) => sum + (Number(s.value) || 0), 0) || 1;
  let acc = 0;
  return (
    <div className="katosync-block ks-donut">
      {title ? <div className="ks-title">{title}</div> : null}
      <div className="ks-donut-row">
        <svg className="ks-donut-svg" viewBox="0 0 42 42" aria-hidden="true">
          <circle className="ks-donut-track" cx="21" cy="21" r="15.9155" />
          {segs.map((s, i) => {
            const len = ((Number(s.value) || 0) / total) * 100;
            const seg = (
              <circle
                className={`ks-donut-seg tone-${tone(s.tone)}`}
                cx="21"
                cy="21"
                r="15.9155"
                strokeDasharray={`${len} ${100 - len}`}
                strokeDashoffset={25 - acc}
                key={i}
              />
            );
            acc += len;
            return seg;
          })}
          <text className="ks-donut-center" x="21" y="22">
            {total}
          </text>
        </svg>
        <ul className="ks-legend">
          {segs.map((s, i) => (
            <li key={i}>
              <span className={`ks-dot tone-${tone(s.tone)}`} />
              <span>{s.label ?? ""}</span>
              <strong>{s.value ?? 0}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Bars({ title, max, bars }: { title?: string; max?: number; bars?: BarItem[] }) {
  const rows = asArray<BarItem>(bars);
  const peak = max ?? Math.max(1, ...rows.map((b) => Number(b.value) || 0));
  return (
    <div className="katosync-block ks-bars">
      {title ? <div className="ks-title">{title}</div> : null}
      {rows.map((b, i) => (
        <div className="ks-bar-row" key={i}>
          <span className="ks-bar-label">{b.label ?? ""}</span>
          <span className="ks-bar-track">
            <span
              className={`ks-bar-fill tone-${tone(b.tone)}`}
              style={{ width: `${Math.min(100, Math.round(((Number(b.value) || 0) / peak) * 100))}%` }}
            />
          </span>
          <span className="ks-bar-value">{b.value ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

export function StatusList({ title, items }: { title?: string; items?: StatusItem[] }) {
  const rows = asArray<StatusItem>(items);
  return (
    <div className="katosync-block ks-status">
      {title ? <div className="ks-title">{title}</div> : null}
      <ul>
        {rows.map((it, i) => (
          <li className={`tone-${tone(it.state)}`} key={i}>
            <span className="ks-dot" />
            <span className="ks-status-label">{it.label ?? ""}</span>
            {it.note ? <span className="ks-status-note">{it.note}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Timeline({ title, items }: { title?: string; items?: TimelineItem[] }) {
  const rows = asArray<TimelineItem>(items);
  return (
    <div className="katosync-block ks-timeline">
      {title ? <div className="ks-title">{title}</div> : null}
      <ul>
        {rows.map((it, i) => {
          const Ico = it.icon ? TL_ICONS[it.icon] : undefined;
          return (
            <li className={`tone-${tone(it.state)}`} key={i}>
              <span className="ks-tl-dot" />
              <div className="ks-tl-body">
                {it.time ? <span className="ks-tl-time">{it.time}</span> : null}
                <span className="ks-tl-label">
                  {Ico ? (
                    <Ico size={13} style={{ verticalAlign: "-2px", marginRight: 6, opacity: 0.75 }} />
                  ) : null}
                  {it.label ?? ""}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Callout({ tone: t, title, text }: { tone?: Tone; title?: string; text?: string }) {
  return (
    <div className={`katosync-block ks-callout tone-${tone(t) === "brand" ? "info" : tone(t)}`}>
      {title ? <strong>{title}</strong> : null}
      {text ? <p>{text}</p> : null}
    </div>
  );
}
