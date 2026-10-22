// Created by NMKato Solutions
// Blueprint handoff preview only: no persistence, upload, approval, memory mutation or agent execution.
import { useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, FileJson2, FileUp, ShieldCheck } from "lucide-react";
import { useT } from "../i18n";
import {
  parseContinuityBlueprint,
  type ContinuityBlueprintPreview
} from "../lib/continuityBlueprint";
import type { RegistryProject } from "../types";

const FILE_LIMIT = 32_768;

export function ContinuityBlueprintPanel({ projects }: { projects: RegistryProject[] }) {
  const { t } = useT();
  const [selected, setSelected] = useState("");
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<ContinuityBlueprintPreview | null>(null);
  const [error, setError] = useState("");
  const inputRevision = useRef(0);
  const project = projects.find((entry) => entry.id === selected);
  const validPreview = preview?.projectId === project?.id ? preview : null;

  function clearResult() {
    setPreview(null);
    setError("");
  }

  function readPreview(text: string) {
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
    } catch {
      // Deliberately never display raw imported JSON or a potentially sensitive parser exception.
      setError(t("continuity.error.invalid"));
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
            disabled={!project}
            onChange={(event) => void fileChanged(event)}
          />
        </label>
        <label className="continuity-paste">
          <span>{t("continuity.paste")}</span>
          <textarea
            rows={5}
            autoCapitalize="off"
            spellCheck={false}
            disabled={!project}
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
            disabled={!project || !input.trim()}
            onClick={() => readPreview(input)}
          >
            {t("continuity.previewButton")}
          </button>
          <small>{t("continuity.privacy")}</small>
        </div>
      </div>

      {error ? (
        <p className="tone-danger" role="alert"><AlertTriangle size={14} /> {error}</p>
      ) : null}

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
            <div><dt>{t("continuity.liveHead")}</dt><dd>{t("continuity.headUnknown")}</dd></div>
          </dl>
          <div className="continuity-notice tone-warn">
            <AlertTriangle size={15} />
            <span>{t("continuity.headWarning")}</span>
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
        </div>
      ) : null}
    </section>
  );
}
