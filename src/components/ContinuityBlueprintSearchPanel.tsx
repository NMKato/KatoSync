// Created by NMKato Solutions
// Read-only scoped FTS5 feature search in imported unverified Blueprint proposals.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, AlertTriangle } from "lucide-react";
import { useT } from "../i18n";

type IndexedSection = {
  projectId: string; eventSequence: number; eventKind: string; sectionKey: string;
  heading: string; excerpt: string; baselineSha: string | null;
  gitBaselineMatches: boolean | null; evidenceJson: string;
  truthStatus: "imported_unverified"; relevance: number;
};


function listedEvidence(raw: string): string[] {
  try {
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    return items.slice(0, 8).map((item) => {
      if (typeof item === "string") return item.slice(0, 240);
      if (!item || typeof item !== "object") return "";
      const data = item as Record<string, unknown>;
      const type = typeof data.kind === "string" ? data.kind.slice(0, 32) + ": " : "";
      const ref = typeof data.ref === "string" ? data.ref.slice(0, 240) : "";
      return type + ref;
    }).filter(Boolean);
  } catch { return []; }
}

export function ContinuityBlueprintSearchPanel({
  projectId, refreshSequence
}: { projectId: string; refreshSequence: number }) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<IndexedSection[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const requestRef = useRef(0);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  useEffect(() => {
    requestRef.current += 1;
    setQuery("");
    setMatches([]);
    setBusy(false);
    setError(false);
  }, [projectId, refreshSequence]);

  async function search() {
    const text = query.trim();
    if (!projectId || !text || text.length > 200 || !window.__TAURI_INTERNALS__) return;
    const selected = projectId;
    const request = ++requestRef.current;
    setBusy(true);
    setError(false);
    try {
      const result = await invoke<IndexedSection[]>("continuity_search_blueprint", {
        projectId: selected, query: text
      });
      if (request !== requestRef.current || projectRef.current !== selected) return;
      if (!Array.isArray(result) || result.some((m) => m.projectId !== selected ||
        m.truthStatus !== "imported_unverified")) throw new Error("invalid_scope");
      setMatches(result);
    } catch {
      if (request === requestRef.current) {
        setMatches([]);
        setError(true);
      }
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  }

  if (!projectId) return null;
  return (
    <section className="continuity-blueprint-search" aria-label={t("continuity.index.title")}>
      <div className="agent-card-title"><Search size={16}/><h4>{t("continuity.index.title")}</h4></div>
      <p className="agent-empty">{t("continuity.index.subtitle")}</p>
      <div className="continuity-actions">
        <input
          className="continuity-index-input"
          type="search" value={query} maxLength={200}
          disabled={busy || !window.__TAURI_INTERNALS__}
          placeholder={t("continuity.index.placeholder")}
          onChange={(e) => { setQuery(e.target.value); setMatches([]); setError(false); requestRef.current += 1; }}
          onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
        />
        <button type="button" className="secondary compact-button" onClick={() => void search()}
          disabled={busy || !query.trim() || !window.__TAURI_INTERNALS__}>
          <Search size={14}/> {busy ? t("continuity.index.searching") : t("continuity.index.search")}
        </button>
      </div>
      {!window.__TAURI_INTERNALS__ ? <small>{t("continuity.index.desktopOnly")}</small> : null}
      {error ? <p className="tone-warn" role="alert"><AlertTriangle size={14}/>{t("continuity.index.unavailable")}</p> : null}
      <div className="continuity-index-results" aria-live="polite">
        {matches.map((match) => (
          <article className="continuity-index-hit" key={match.eventSequence + ":" + match.sectionKey}>
            <div className="continuity-result-head">
              <strong>{match.heading}</strong>
              <small>{match.eventKind === "milestone" ? t("continuity.index.milestone") : t("continuity.index.blueprint")}</small>
            </div>
            <small>{t("continuity.index.origin")} #{match.eventSequence} · {match.sectionKey}</small>
            <p>{match.excerpt}</p>
            {listedEvidence(match.evidenceJson).length > 0 ? (
              <small>{t("continuity.index.evidence")}: {listedEvidence(match.evidenceJson).join(" · ")}</small>
            ) : null}
            <small className="tone-warn">{t("continuity.index.unverified")}</small>
            <p className="agent-empty">{match.gitBaselineMatches === true
              ? t("continuity.index.sameGit")
              : match.gitBaselineMatches === false ? t("continuity.index.changedGit")
                : t("continuity.index.noGit")}</p>
          </article>
        ))}
      </div>
      {matches.length === 0 && !busy && query.trim() && !error
        ? <small>{t("continuity.index.noResultsHint")}</small> : null}
      <p className="continuity-notice">{t("continuity.index.disclaimer")}</p>
    </section>
  );
}
