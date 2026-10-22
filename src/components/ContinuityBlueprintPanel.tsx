// Created by NMKato Solutions
// User-reviewed handoff: preview plus explicit unverified local journal save, never canonical approval or agent execution.
import { useRef, useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, FileJson2, FileUp, ShieldCheck } from "lucide-react";
import { useT } from "../i18n";
import {
  parseContinuityBlueprint,
  type ContinuityBlueprintPreview
} from "../lib/continuityBlueprint";
import type { RegistryProject } from "../types";
import { ContinuityTimelinePanel } from "./ContinuityTimelinePanel";
import { ContinuityLocalChatPanel } from "./ContinuityLocalChatPanel";

const FILE_LIMIT = 32_768;
const JOURNAL_LIMIT = 8192;

type NativePreflight = {
  projectId: string;
  gitHead: string;
  previousHash: string | null;
  nextSequence: number;
  proposalOnly: true;
};
type JournalAppendResult = { event: { sequence: number; eventHash: string }; replayed: boolean };

export function ContinuityBlueprintPanel({ projects }: { projects: RegistryProject[] }) {
  const { t } = useT();
  const [selected, setSelected] = useState("");
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<ContinuityBlueprintPreview | null>(null);
  const [error, setError] = useState("");
  const [nativePreflight, setNativePreflight] = useState<NativePreflight | null>(null);
  const [preflightError, setPreflightError] = useState("");
  const [preflighting, setPreflighting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [saved, setSaved] = useState<JournalAppendResult | null>(null);
  const inputRevision = useRef(0);
  const project = projects.find((entry) => entry.id === selected);
  const validPreview = preview?.projectId === project?.id ? preview : null;

  function clearResult() {
    setPreview(null);
    setError("");
    setNativePreflight(null);
    setPreflightError("");
    setPreflighting(false);
    setReviewed(false);
    setSaved(null);
  }

  async function readPreview(text: string) {
    const revision = ++inputRevision.current;
    clearResult();
    if (!project) {
      setError(t("continuity.error.project"));
      return;
    }
    try {
      // The registry confirms only identity. A cached scan is NOT a fresh, native HEAD preflight.
      // Mark drift unknown rather than claiming a match based on stale registry data.
      const parsed = parseContinuityBlueprint(text, {
        registeredProjectId: project.id,
        currentGitHead: null
      });
      setPreview(parsed);
      if (!window.__TAURI_INTERNALS__) return;
      setPreflighting(true);
      try {
        const fresh = await invoke<NativePreflight>("continuity_preflight", { projectId: project.id });
        if (revision !== inputRevision.current) return;
        setNativePreflight(fresh);
        setPreview(parseContinuityBlueprint(text, { registeredProjectId: project.id, currentGitHead: fresh.gitHead }));
      } catch {
        if (revision === inputRevision.current) setPreflightError(t("continuity.error.preflight"));
      } finally {
        if (revision === inputRevision.current) setPreflighting(false);
      }
    } catch {
      // Deliberately never display raw imported JSON or a potentially sensitive parser exception.
      setError(t("continuity.error.invalid"));
    }
  }

  async function saveBlueprint() {
    if (!project || !validPreview || !nativePreflight || saving || !reviewed || saved) return;
    if (new TextEncoder().encode(input).byteLength > JOURNAL_LIMIT) {
      setError(t("continuity.error.journalSize"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const receipt = await invoke<JournalAppendResult>("continuity_save_blueprint", {
        projectId: project.id,
        rawJson: input,
        expectedHead: nativePreflight.gitHead,
        expectedPrevHash: nativePreflight.previousHash
      });
      setSaved(receipt);
    } catch {
      setError(t("continuity.error.save"));
      setNativePreflight(null);
      setReviewed(false);
    } finally {
      setSaving(false);
    }
  }

  async function fileChanged(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const revision = ++inputRevision.current;
    event.target.value = "";
    if (!file) return;
    clearResult();
    if (file.size > FILE_LIMIT || !file.name.toLowerCase().endsWith(".json")) {
      setInput("");
      setError(t("continuity.error.file"));
      return;
    }
    try {
      const text = await file.text();
      if (revision !== inputRevision.current) return;
      if (new TextEncoder().encode(text).byteLength > FILE_LIMIT) {
        setInput("");
        setError(t("continuity.error.file"));
        return;
      }
      setInput(text);
      // Explicit review button is required; selecting a file does not approve or persist it.
    } catch {
      setInput("");
      setError(t("continuity.error.file"));
    }
  }

  return (
    <section className="glass agent-card continuity-panel" aria-label={t("continuity.title")}>
      <div className="agent-card-title">
        <FileJson2 size={17} />
        <h3>{t("continuity.title")}</h3>
      </div>
      <p className="agent-empty">{t("continuity.subtitle")}</p>
      <div className="continuity-form">
        <label className="projects-select">
          <span>{t("continuity.project")}</span>
          <select
            value={project?.id ?? ""}
            disabled={saving}
            onChange={(event) => {
              inputRevision.current += 1;
              setSelected(event.target.value);
              setInput("");
              clearResult();
            }}
          >
            <option value="">{t("continuity.selectProject")}</option>
            {projects.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
        </label>
        <label className="continuity-file">
          <FileUp size={15} />
          {t("continuity.file")}
          <input
            type="file"
            accept=".json,application/json"
            disabled={!project || saving}
            onChange={(event) => void fileChanged(event)}
          />
        </label>
        <label className="continuity-paste">
          <span>{t("continuity.paste")}</span>
          <textarea
            rows={5}
            autoCapitalize="off"
            spellCheck={false}
            disabled={!project || saving}
            placeholder={t("continuity.placeholder")}
            value={input}
            onChange={(event) => {
              inputRevision.current += 1;
              setInput(event.target.value);
              clearResult();
            }}
          />
        </label>
        <div className="continuity-actions">
          <button
            className="secondary compact-button"
            type="button"
            disabled={!project || !input.trim() || saving || preflighting}
            onClick={() => void readPreview(input)}
          >
            {t("continuity.previewButton")}
          </button>
          <small>{t("continuity.privacy")}</small>
        </div>
      </div>

      {preflighting ? <p className="agent-empty" role="status">{t("continuity.checking")}</p> : null}
      {preflightError ? <p className="tone-warn" role="status">{preflightError}</p> : null}
      {error ? (
        <p className="tone-danger" role="alert"><AlertTriangle size={14} /> {error}</p>
      ) : null}

      <ContinuityTimelinePanel projectId={project?.id ?? ""} refreshSequence={saved?.event.sequence ?? 0} />
      <ContinuityLocalChatPanel key={project?.id ?? ""} projectId={project?.id ?? ""} projectName={project?.name ?? ""} />

      {validPreview ? (
        <div className="continuity-results" role="region" aria-label={t("continuity.previewTitle")}>
          <div className="continuity-result-head">
            <strong>{t("continuity.previewTitle")}: {validPreview.title}</strong>
            <span className="projects-badge tone-warn">{t("continuity.unverified")}</span>
          </div>
          <p>{validPreview.intent}</p>
          <dl className="continuity-facts">
            <div><dt>{t("continuity.blueprintId")}</dt><dd>{validPreview.blueprintId} · v{validPreview.revision}</dd></div>
            <div><dt>{t("continuity.origin")}</dt><dd>{validPreview.source.label}</dd></div>
            <div><dt>{t("continuity.baseHead")}</dt><dd>{validPreview.baseGitHead?.slice(0, 12) ?? "—"}</dd></div>
            <div><dt>{t("continuity.liveHead")}</dt><dd>{nativePreflight?.gitHead.slice(0, 12) ?? t("continuity.headUnknown")}</dd></div>
          </dl>
          <div className="continuity-notice tone-warn">
            <AlertTriangle size={15} />
            <span>{!nativePreflight ? t("continuity.headWarning") : validPreview.headState === "stale" ? t("continuity.headMismatch") : t("continuity.headConfirmed")}</span>
          </div>
          <h4>{t("continuity.decisions")} ({validPreview.decisions.length})</h4>
          {validPreview.decisions.length ? (
            <ol className="continuity-decisions">
              {validPreview.decisions.map((decision) => (
                <li key={decision.id}>
                  <strong>{decision.id} · {decision.title}</strong>
                  <dl>
                    <div><dt>{t("continuity.choice")}</dt><dd>{decision.choice}</dd></div>
                    <div><dt>{t("continuity.why")}</dt><dd>{decision.rationale}</dd></div>
                    <div><dt>{t("continuity.alternatives")}</dt><dd>{decision.alternatives.join(" · ") || "—"}</dd></div>
                    <div><dt>{t("continuity.consequences")}</dt><dd>{decision.consequences.join(" · ") || "—"}</dd></div>
                    <div><dt>{t("continuity.evidence")}</dt><dd>{decision.evidence.map((item) => item.ref).join(" · ") || "—"}</dd></div>
                  </dl>
                </li>
              ))}
            </ol>
          ) : <p className="agent-empty">{t("continuity.noDecisions")}</p>}
          <h4>{t("continuity.nextSteps")}</h4>
          <ul>{validPreview.nextSteps.map((step, i) => <li key={i}>{step}</li>)}</ul>
          <p className="continuity-notice">
            <ShieldCheck size={15} />
            <span>{t("continuity.readOnly")}</span>
          </p>
          {nativePreflight && validPreview.headState !== "stale" ? (
            <div className="continuity-save">
              <label>
                <input type="checkbox" checked={reviewed} disabled={saving || Boolean(saved)}
                  onChange={(event) => setReviewed(event.target.checked)} />
                {t("continuity.reviewConfirm")}
              </label>
              <div className="continuity-actions">
                <button type="button" className="secondary compact-button"
                  disabled={!reviewed || saving || Boolean(saved) || new TextEncoder().encode(input).byteLength > JOURNAL_LIMIT}
                  onClick={() => void saveBlueprint()}>{saving ? t("continuity.saving") : t("continuity.saveProposal")}</button>
                {saved ? <span className="tone-ok" role="status">{t("continuity.saved")} #{saved.event.sequence}</span> : null}
              </div>
              <small>{t("continuity.journalHint")}</small>
              {new TextEncoder().encode(input).byteLength > JOURNAL_LIMIT ? <small className="tone-warn">{t("continuity.error.journalSize")}</small> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
