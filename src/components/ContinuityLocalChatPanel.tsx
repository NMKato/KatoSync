// Created by NMKato Solutions
// Operator-initiated local Q&A. Never invokes provider auto-routing or cloud endpoints.
import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BrainCircuit, Send, ShieldCheck } from "lucide-react";
import { useT } from "../i18n";

type Citation = { index: number; sourceRef: string; truthLevel: "verified" | "canonical" | "observed"; freshness: string };
type LocalAnswer = {
  projectId: string;
  liveGitHead: string;
  answer: string;
  citations: Citation[];
  localBrainUsed: boolean;
  verifiedMemoryOnly: true;
  sessionOnly: true;
};
type Turn = { id: number; question: string; response: LocalAnswer };

export function ContinuityLocalChatPanel({ projectId }: { projectId: string }) {
  const { t } = useT();
  const [question, setQuestion] = useState("");
  const [session, setSession] = useState<{ projectId: string; turns: Turn[] }>({ projectId: "", turns: [] });
  const [busyProject, setBusyProject] = useState("");
  const [error, setError] = useState("");
  const nextId = useRef(0);
  const projectRef = useRef(projectId);
  // Guard on render and async completion; never display one project's answers in another.
  projectRef.current = projectId;
  const turns = session.projectId === projectId ? session.turns : [];
  const busy = busyProject === projectId;

  async function send() {
    const selected = projectId;
    const text = question.trim();
    if (!window.__TAURI_INTERNALS__ || !selected || busy || !text || text.length > 1200) return;
    const requestId = ++nextId.current;
    setBusyProject(selected);
    setError("");
    setQuestion("");
    try {
      const response = await invoke<LocalAnswer>("continuity_local_answer", {
        projectId: selected,
        question: text
      });
      if (projectRef.current !== selected || response.projectId !== selected ||
        response.verifiedMemoryOnly !== true || response.sessionOnly !== true) return;
      setSession((current) => ({
        projectId: selected,
        turns: [
          ...(current.projectId === selected ? current.turns : []).slice(-9),
          { id: requestId, question: text, response }
        ]
      }));
    } catch {
      if (projectRef.current === selected) {
        setError(t("continuity.chat.unavailable"));
        setQuestion(text);
      }
    } finally {
      setBusyProject((current) => current === selected ? "" : current);
    }
  }

  if (!projectId) return null;
  return (
    <section className="continuity-local-chat" aria-label={t("continuity.chat.title")}>
      <div className="agent-card-title">
        <BrainCircuit size={16} />
        <h4>{t("continuity.chat.title")}</h4>
      </div>
      <p className="agent-empty">{t("continuity.chat.subtitle")}</p>
      {!window.__TAURI_INTERNALS__ ? <p className="tone-warn">{t("continuity.chat.desktopOnly")}</p> : null}
      <div className="continuity-chat-transcript" role="log" aria-live="polite" aria-label={t("continuity.chat.history")}>
        {turns.length ? turns.map((turn) => (
          <div key={turn.id} className="continuity-chat-turn">
            <p><strong>{t("continuity.chat.question")}</strong> {turn.question}</p>
            <p><strong>{t("continuity.chat.answer")}</strong> {
              turn.response.answer === "NOT_IN_MEMORY"
                ? t("continuity.chat.noEvidence")
                : turn.response.answer
            }</p>
            {turn.response.citations.length > 0 ? (
              <ul aria-label={t("continuity.chat.sources")}>
                {turn.response.citations.map((cite) => <li key={cite.index}>
                  [{cite.index}] {cite.sourceRef} · {cite.truthLevel} · {cite.freshness}
                </li>)}
              </ul>
            ) : null}
            <small>{t("continuity.chat.localLabel")} · Git {turn.response.liveGitHead.slice(0, 12)}</small>
          </div>
        )) : <p className="agent-empty">{t("continuity.chat.empty")}</p>}
      </div>
      <label className="continuity-paste">
        <span>{t("continuity.chat.ask")}</span>
        <textarea rows={3} maxLength={1200} value={question}
          disabled={busy || !window.__TAURI_INTERNALS__}
          placeholder={t("continuity.chat.placeholder")}
          onChange={(event) => { setQuestion(event.target.value); setError(""); }}
        />
      </label>
      <div className="continuity-actions">
        <button type="button" className="secondary compact-button" onClick={() => void send()}
          disabled={!question.trim() || busy || !window.__TAURI_INTERNALS__}>
          <Send size={14} /> {busy ? t("continuity.chat.thinking") : t("continuity.chat.send")}
        </button>
        <small>{t("continuity.chat.sessionOnly")}</small>
      </div>
      {error ? <p className="tone-warn" role="alert">{error}</p> : null}
      <p className="continuity-notice"><ShieldCheck size={14}/>
        <span>{t("continuity.chat.noCloud")}</span>
      </p>
    </section>
  );
}
