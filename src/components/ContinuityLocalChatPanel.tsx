// Created by NMKato Solutions
// Project-scoped, durable, local-only Q&A. Model-generated text never becomes canonical truth.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BrainCircuit, RefreshCcw, Send, ShieldCheck } from "lucide-react";
import { useT } from "../i18n";

type Citation = { index: number; sourceRef: string; truthLevel: string; freshness: string };
type ChatTurn = {
  projectId: string;
  sequence: number;
  question: string;
  answer: string;
  gitHead: string;
  citationsJson: string;
  createdAt: string;
};
const MAX_QUESTION = 1200;

function citationsFor(turn: ChatTurn): Citation[] {
  try {
    const items: unknown = JSON.parse(turn.citationsJson);
    if (!Array.isArray(items)) return [];
    return items.slice(0, 8).filter((item): item is Citation =>
      item !== null && typeof item === "object" &&
      typeof item.sourceRef === "string" && typeof item.index === "number" &&
      typeof item.truthLevel === "string" && typeof item.freshness === "string");
  } catch {
    return [];
  }
}

export function ContinuityLocalChatPanel({ projectId }: { projectId: string }) {
  const { t } = useT();
  const [question, setQuestion] = useState("");
  const [session, setSession] = useState<{ projectId: string; turns: ChatTurn[] }>({ projectId: "", turns: [] });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const turns = session.projectId === projectId ? session.turns : [];
  const latestSequence = turns.length ? turns[turns.length - 1].sequence : 0;

  async function refresh() {
    const current = projectId;
    const request = ++requestRef.current;
    setError("");
    setLoaded(false);
    if (!current || !window.__TAURI_INTERNALS__) return;
    setBusy(true);
    try {
      const result = await invoke<ChatTurn[]>("continuity_chat_history", { projectId: current });
      if (requestRef.current !== request || projectRef.current !== current) return;
      if (!Array.isArray(result) || result.some((turn) => turn.projectId !== current)) {
        throw new Error("foreign_project");
      }
      setSession({ projectId: current, turns: result });
      setLoaded(true);
    } catch {
      if (requestRef.current === request) setError(t("continuity.chat.historyUnavailable"));
    } finally {
      if (requestRef.current === request) setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    return () => { requestRef.current += 1; };
    // Refresh only on selected project change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function send() {
    const current = projectId;
    const text = question.trim();
    if (!window.__TAURI_INTERNALS__ || !loaded || !current || busy ||
        !text || Array.from(text).length > MAX_QUESTION) return;
    const request = ++requestRef.current;
    const expected = latestSequence;
    setBusy(true);
    setError("");
    try {
      const result = await invoke<ChatTurn>("continuity_chat_send", {
        projectId: current, question: text, expectedSequence: expected
      });
      if (requestRef.current !== request || projectRef.current !== current) return;
      if (result.projectId !== current || result.sequence !== expected + 1) {
        throw new Error("stale_or_foreign_result");
      }
      setSession((prev) => ({
        projectId: current,
        turns: [...(prev.projectId === current ? prev.turns : []), result].slice(-20)
      }));
      setQuestion("");
    } catch {
      if (requestRef.current === request) {
        setError(t("continuity.chat.saveError"));
        setLoaded(false); // recheck native sequence rather than blindly retrying writes
      }
    } finally {
      if (requestRef.current === request) setBusy(false);
    }
  }

  if (!projectId) return null;
  return (
    <section className="continuity-local-chat" aria-label={t("continuity.chat.title")}>
      <div className="continuity-result-head">
        <div className="agent-card-title">
          <BrainCircuit size={16}/>
          <h4>{t("continuity.chat.title")}</h4>
        </div>
        <button type="button" className="ghost compact-button" onClick={() => void refresh()}
          disabled={busy || !window.__TAURI_INTERNALS__}>
          <RefreshCcw size={13}/> {t("continuity.chat.reload")}
        </button>
      </div>
      <p className="agent-empty">{t("continuity.chat.persistentSubtitle")}</p>
      {!window.__TAURI_INTERNALS__ ? <p className="tone-warn">{t("continuity.chat.desktopOnly")}</p> : null}
      <div className="continuity-chat-transcript" role="log" aria-live="polite"
        aria-label={t("continuity.chat.history")}>
        {turns.length ? turns.map((turn) => (
          <div key={turn.sequence} className="continuity-chat-turn">
            <p><strong>{t("continuity.chat.question")}</strong> {turn.question}</p>
            <p><strong>{t("continuity.chat.answer")}</strong> {
              turn.answer === "NOT_IN_MEMORY" ? t("continuity.chat.noEvidence") : turn.answer
            }</p>
            {citationsFor(turn).length ? (
              <ul aria-label={t("continuity.chat.sources")}>
                {citationsFor(turn).map((cite) => <li key={cite.index}>
                  [{cite.index}] {cite.sourceRef} · {cite.truthLevel} · {cite.freshness}
                </li>)}
              </ul>
            ) : null}
            <small>#{turn.sequence} · {turn.createdAt} · Git {turn.gitHead.slice(0,12)}</small>
          </div>
        )) : <p className="agent-empty">{t("continuity.chat.empty")}</p>}
      </div>
      <label className="continuity-paste">
        <span>{t("continuity.chat.ask")}</span>
        <textarea rows={3} maxLength={MAX_QUESTION} value={question}
          disabled={busy || !loaded || !window.__TAURI_INTERNALS__}
          placeholder={t("continuity.chat.placeholder")}
          onChange={(event) => { setQuestion(event.target.value); setError(""); }}
        />
      </label>
      <div className="continuity-actions">
        <button type="button" className="secondary compact-button" onClick={() => void send()}
          disabled={!question.trim() || !loaded || busy || !window.__TAURI_INTERNALS__}>
          <Send size={14}/> {busy ? t("continuity.chat.thinking") : t("continuity.chat.send")}
        </button>
        <small>{t("continuity.chat.durableLabel")}</small>
      </div>
      {error ? <p className="tone-warn" role="alert">{error}</p> : null}
      <p className="continuity-notice"><ShieldCheck size={14}/>
        <span>{t("continuity.chat.persistNotice")}</span>
      </p>
    </section>
  );
}
