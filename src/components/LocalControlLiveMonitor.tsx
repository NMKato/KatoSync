import { Activity, CheckCircle2, Clock3, RefreshCcw, TerminalSquare, XCircle } from "lucide-react";
import type { LocalControlMonitorSnapshot } from "../types";
import { useT } from "../i18n";

interface Props {
  snapshot: LocalControlMonitorSnapshot | null;
  error: string | null;
  onRefresh: () => void;
}

function duration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function timeLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

export function LocalControlLiveMonitor({ snapshot, error, onRefresh }: Props) {
  const { t } = useT();
  const state = snapshot?.state ?? null;
  const jobs = snapshot?.recentJobs ?? [];
  const stats = snapshot?.stats ?? { total: 0, completed: 0, failed: 0, timeout: 0, avgDurationMs: 0 };
  const status = !snapshot?.available ? "offline" : (state?.status ?? "unknown");
  const successRate = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;

  const commandCounts = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.command] = (acc[job.command] ?? 0) + 1;
    return acc;
  }, {});
  const commands = Object.entries(commandCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCount = Math.max(1, ...commands.map(([, count]) => count));

  return (
    <div className="local-monitor">
      <div className="local-monitor-head">
        <div>
          <div className="local-monitor-title">
            <span className={`monitor-dot ${status}`} />
            <strong>{t("monitor.title")}</strong>
            <span className={`monitor-status ${status}`}>{status.toUpperCase()}</span>
          </div>
          <small>
            {state
              ? t("monitor.heartbeat", { time: timeLabel(state.heartbeatAt) })
              : t("monitor.offline")}
          </small>
        </div>
        <button className="secondary compact-button" onClick={onRefresh} type="button">
          <RefreshCcw size={14} />
          {t("monitor.refresh")}
        </button>
      </div>

      {error ? <div className="monitor-error">{error}</div> : null}

      <div className="monitor-kpis">
        <article>
          <Activity size={16} />
          <span>{t("monitor.current")}</span>
          <strong>{state?.currentJobId ?? t("monitor.idle")}</strong>
        </article>
        <article>
          <CheckCircle2 size={16} />
          <span>{t("monitor.success")}</span>
          <strong>{successRate}%</strong>
        </article>
        <article>
          <TerminalSquare size={16} />
          <span>{t("monitor.jobs")}</span>
          <strong>{stats.total}</strong>
        </article>
        <article>
          <Clock3 size={16} />
          <span>{t("monitor.average")}</span>
          <strong>{duration(stats.avgDurationMs)}</strong>
        </article>
      </div>

      <div className="monitor-grid">
        <section className="monitor-card">
          <div className="monitor-card-title">{t("monitor.commands")}</div>
          {commands.length ? (
            <div className="monitor-bars">
              {commands.map(([command, count]) => (
                <div className="monitor-bar-row" key={command}>
                  <div className="monitor-bar-label">
                    <span>{command}</span><strong>{count}</strong>
                  </div>
                  <div className="monitor-bar-track">
                    <span style={{ width: `${Math.max(8, (count / maxCount) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="monitor-empty">{t("monitor.noJobs")}</p>}
        </section>

        <section className="monitor-card">
          <div className="monitor-card-title">{t("monitor.recentJobs")}</div>
          <div className="monitor-job-list">
            {jobs.slice(0, 8).map((job) => (
              <article className={`monitor-job ${job.status}`} key={job.id}>
                <span className="monitor-job-icon">
                  {job.status === "completed" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                </span>
                <div>
                  <strong>{job.command}</strong>
                  <small>{job.mode} · {duration(job.durationMs)} · {timeLabel(job.finishedAt)}</small>
                </div>
                <code>{job.exitCode ?? "—"}</code>
              </article>
            ))}
            {!jobs.length ? <p className="monitor-empty">{t("monitor.noJobs")}</p> : null}
          </div>
        </section>
      </div>

      <section className="monitor-card monitor-feed-card">
        <div className="monitor-card-title">{t("monitor.feed")}</div>
        <div className="monitor-feed">
          {(snapshot?.feed ?? []).slice(-24).map((line, index) => <code key={`${index}-${line}`}>{line}</code>)}
          {!snapshot?.feed?.length ? <span className="monitor-empty">{t("monitor.noFeed")}</span> : null}
        </div>
      </section>
    </div>
  );
}
