// Created by Nikolas Kato on 2026-06-28
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Format-Contract: Mistral/KAI-Personas betten strukturierte Daten als Markdown-Codebloecke ein:
//   ```katosync:kpi ```      -> { title?, items:[{ label, value, delta?, tone? }] }
//   ```katosync:donut ```    -> { title?, segments:[{ label, value, tone? }] }
//   ```katosync:bar ```      -> { title?, max?, bars:[{ label, value, tone? }] }
//   ```katosync:status ```   -> { title?, items:[{ label, state, note? }] }   state: ok|warn|danger|info
//   ```katosync:timeline ``` -> { title?, items:[{ time?, label, state? }] }
//   ```katosync:callout ```  -> { tone?, title?, text }
// tone: brand|ok|warn|danger|info. Unbekannt/ungueltiges JSON -> faellt auf Rohtext zurueck.

type Tone = "brand" | "ok" | "warn" | "danger" | "info";

interface KpiItem {
  label?: string;
  value?: string | number;
  delta?: string | number;
  tone?: Tone;
}
interface Segment {
  label?: string;
  value?: number;
  tone?: Tone;
}
interface BarItem {
  label?: string;
  value?: number;
  tone?: Tone;
}
interface StatusItem {
  label?: string;
  state?: Tone;
  note?: string;
}
interface TimelineItem {
  time?: string;
  label?: string;
  state?: Tone;
}

const tone = (t?: string): Tone => {
  const allowed: Tone[] = ["brand", "ok", "warn", "danger", "info"];
  return allowed.includes(t as Tone) ? (t as Tone) : "brand";
};
const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

function KpiTiles({ title, items }: { title?: string; items?: KpiItem[] }) {
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

function Donut({ title, segments }: { title?: string; segments?: Segment[] }) {
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

function Bars({ title, max, bars }: { title?: string; max?: number; bars?: BarItem[] }) {
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

function StatusList({ title, items }: { title?: string; items?: StatusItem[] }) {
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

function Timeline({ title, items }: { title?: string; items?: TimelineItem[] }) {
  const rows = asArray<TimelineItem>(items);
  return (
    <div className="katosync-block ks-timeline">
      {title ? <div className="ks-title">{title}</div> : null}
      <ul>
        {rows.map((it, i) => (
          <li className={`tone-${tone(it.state)}`} key={i}>
            <span className="ks-tl-dot" />
            <div className="ks-tl-body">
              {it.time ? <span className="ks-tl-time">{it.time}</span> : null}
              <span className="ks-tl-label">{it.label ?? ""}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Callout({ tone: t, title, text }: { tone?: Tone; title?: string; text?: string }) {
  return (
    <div className={`katosync-block ks-callout tone-${tone(t) === "brand" ? "info" : tone(t)}`}>
      {title ? <strong>{title}</strong> : null}
      {text ? <p>{text}</p> : null}
    </div>
  );
}

function KatosyncBlock({ type, raw }: { type: string; raw: string }) {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return <pre className="katosync-block katosync-raw">{raw}</pre>;
  }
  switch (type) {
    case "kpi":
      return <KpiTiles {...(data as { title?: string; items?: KpiItem[] })} />;
    case "donut":
      return <Donut {...(data as { title?: string; segments?: Segment[] })} />;
    case "bar":
      return <Bars {...(data as { title?: string; max?: number; bars?: BarItem[] })} />;
    case "status":
      return <StatusList {...(data as { title?: string; items?: StatusItem[] })} />;
    case "timeline":
      return <Timeline {...(data as { title?: string; items?: TimelineItem[] })} />;
    case "callout":
      return <Callout {...(data as { tone?: Tone; title?: string; text?: string })} />;
    default:
      return <pre className="katosync-block katosync-raw">{raw}</pre>;
  }
}

// Markdown mit eingebetteten KatoSync-Komponenten (```katosync:<typ>```).
export function RichMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code(props) {
          const { className, children: codeChildren } = props as {
            className?: string;
            children?: unknown;
          };
          const match = /language-katosync:(\w+)/.exec(className || "");
          if (match) {
            return <KatosyncBlock type={match[1]} raw={String(codeChildren ?? "").trim()} />;
          }
          return <code className={className}>{codeChildren as never}</code>;
        }
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
