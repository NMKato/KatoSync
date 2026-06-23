import {
  AlertTriangle,
  CheckCircle2,
  type LucideIcon
} from "lucide-react";
import type { ScanSummary } from "../types";

export interface Notice {
  kind: "ok" | "warn" | "error" | "info";
  text: string;
}

export function Panel({
  id,
  title,
  icon,
  children,
  className = ""
}: {
  id?: string;
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`} id={id}>
      {title ? (
        <div className="panel-head">
          <div>
            {icon}
            <h3>{title}</h3>
          </div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Toggle({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle">
      <button
        aria-pressed={checked}
        className={checked ? "switch on" : "switch"}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span />
      </button>
      <span>{label}</span>
    </label>
  );
}

export function StatusLine({ good, text }: { good: boolean; text: string }) {
  return (
    <div className={good ? "status-line good" : "status-line warn"}>
      {good ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
      <span>{text}</span>
    </div>
  );
}

export function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <div className={`notice ${notice.kind}`}>
      <span>{notice.text}</span>
      <button onClick={onClose} type="button">
        Schließen
      </button>
    </div>
  );
}

export function FindingsTable({ scan }: { scan: ScanSummary | null }) {
  if (!scan) {
    return <div className="empty-state">Starte einen Scan, um relevante Dateien zu sehen.</div>;
  }
  const visibleFindings = scan.findings.filter(
    (finding) => finding.category !== "ignore" && finding.category !== "missing"
  );
  if (!visibleFindings.length) {
    return (
      <div className="empty-state">
        Keine relevanten Status-, Memory-, Roadmap- oder Task-Dateien gefunden.
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Datei</th>
            <th>Kategorie</th>
            <th>Größe</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {visibleFindings.slice(0, 12).map((finding) => (
            <tr key={`${finding.path}-${finding.reason || "ok"}`} className={finding.skipped ? "muted" : ""}>
              <td>{finding.relativePath}</td>
              <td>{finding.category}</td>
              <td>{formatBytes(finding.sizeBytes)}</td>
              <td>{finding.reason || "bereit"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StepButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "step active" : "step"} onClick={onClick} type="button" title={label}>
      <Icon size={17} />
      <span>{label}</span>
    </button>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
