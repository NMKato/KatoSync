// Created by NMKato Solutions
// Local read-only timeline and manual, explicitly copied handoff. No network or agent execution.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, ClipboardCopy, History, RefreshCcw, ShieldCheck } from "lucide-react";
import { useT } from "../i18n";
import {
  buildContinuityHandoff,
  continuityEventDecisions,
  type ContinuityTimelineRead
} from "../lib/continuityHandoff";

export function ContinuityTimelinePanel({
  projectId, refreshSequence
}: {
  projectId: string;
  refreshSequence: number;
}) {
  const { t } = useT();
  const requestId = useRef(0);
  const [timeline, setTimeline] = useState<ContinuityTimelineRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");
  const activeTimeline = timeline?.projectId === projectId ? timeline : null;
  const packet = useMemo(() => activeTimeline ? buildContinuityHandoff(activeTimeline) : "",
    [activeTimeline]);

  async function load() {
    const request = ++requestId.current;
    setTimeline(null);
    setFailed(false);
    setCopyState("idle");
    if (!projectId || !window.__TAURI_INTERNALS__) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const result = await invoke<ContinuityTimelineRead>("continuity_timeline", { projectId });
      if (request !== requestId.current) return;
      if (result.projectId !== projectId || !result.unverified || !result.offlineLocalOnly) {
        setFailed(true);
        return;
      }
      setTimeline(result);
    } catch {
      if (request === requestId.current) setFailed(true);
    } finally {
      if (request === requestId.current) setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
    // Loading is tied to project switch or a successful local save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshSequence]);

  async function copy() {
    if (!packet) return;
    try {
      await navigator.clipboard.writeText(packet);
      setCopyState("done");
    } catch {
      setCopyState("error");
    }
  }

  if (!projectId) return null;
  return (
    <section className="continuity-timeline" aria-label={t("continuity.timeline.title")}>
      <div className="continuity-result-head">
        <div className="agent-card-title">
          <History size={16} />
          <h4>{t("continuity.timeline.title")}</h4>
        </div>
        <button type="button" className="ghost compact-button" disabled={busy}
          onClick={() => void load()}>
          <RefreshCcw size={13} /> {t("continuity.timeline.refresh")}
        </button>
      </div>
      <small className="agent-empty">{t("continuity.timeline.subtitle")}</small>
      {!window.__TAURI_INTERNALS__
        ? <p className="agent-empty">{t("continuity.timeline.desktopOnly")}</p>
        : null}
      {busy ? <p role="status" className="agent-empty">{t("continuity.timeline.loading")}</p> : null}
      {failed ? <p role="status" className="tone-warn"><AlertTriangle size={14} />
        {t("continuity.timeline.unavailable")}</p> : null}
      {activeTimeline ? (
        <>
          <div className="continuity-facts">
            <div><dt>{t("continuity.liveHead")}</dt>
              <dd><code>{activeTimeline.liveGitHead.slice(0, 12)}</code></dd></div>
            <div><dt>{t("continuity.timeline.latest")}</dt>
              <dd>#{activeTimeline.latestSequence}</dd></div>
          </div>
          {activeTimeline.events.length === 0 ? (
            <p className="agent-empty">{t("continuity.timeline.empty")}</p>
          ) : (
            <ol className="continuity-history">
              {activeTimeline.events.map((event) => {
                const decisions = continuityEventDecisions(event);
                const stale = event.baseGitHead &&
                  event.baseGitHead.toLowerCase() !== activeTimeline.liveGitHead.toLowerCase();
                return (
                  <li key={event.projectId + "-" + event.sequence}>
                    <details>
                      <summary>
                        <strong>#{event.sequence} · {event.summary}</strong>
                        <small>{event.createdAt} · {event.kind}</small>
                        {stale ? <small className="tone-warn">{t("continuity.timeline.stale")}</small> : null}
                      </summary>
                      <div className="continuity-history-detail">
                        <p>{t("continuity.timeline.unverified")}</p>
                        <small>{t("continuity.baseHead")}: {event.baseGitHead?.slice(0, 12) ?? "—"}</small>
                        {decisions.length ? <ul>{decisions.map((decision) => (
                          <li key={decision.id}>
                            <strong>{decision.id}: {decision.title}</strong>
                            <p>{t("continuity.choice")}: {decision.choice}</p>
                            <p>{t("continuity.why")}: {decision.rationale}</p>
                            {decision.alternatives.length ? (
                              <p>{t("continuity.alternatives")}: {decision.alternatives.join(" · ")}</p>
                            ) : null}
                            {decision.evidence.length ? (
                              <p>{t("continuity.evidence")}: {decision.evidence.join(" · ")}</p>
                            ) : null}
                          </li>
                        ))}</ul> : null}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="continuity-handoff">
            <h4>{t("continuity.timeline.handoff")}</h4>
            <p className="agent-empty">{t("continuity.timeline.handoffHint")}</p>
            <textarea rows={7} readOnly spellCheck={false}
              aria-label={t("continuity.timeline.handoff")}
              value={packet}
            />
            <div className="continuity-actions">
              <button type="button" className="secondary compact-button"
                onClick={() => void copy()} disabled={!packet}>
                <ClipboardCopy size={14} /> {t("continuity.timeline.copy")}
              </button>
              {copyState === "done" ? <small role="status">{t("continuity.timeline.copied")}</small> : null}
              {copyState === "error" ? <small role="alert" className="tone-warn">{t("continuity.timeline.copyError")}</small> : null}
            </div>
            <p className="continuity-notice">
              <ShieldCheck size={14} />
              <span>{t("continuity.timeline.noAuthority")}</span>
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}
