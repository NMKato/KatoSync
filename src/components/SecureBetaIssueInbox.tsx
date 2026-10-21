// Created by NMKato Solutions
// Verified, read-only Issue Inbox integrated with the local Project Registry.
import { useMemo, useState } from "react";
import { Check, GitBranch, Loader2, RefreshCcw, ShieldCheck, ShieldAlert } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { buildIssueInbox, type IssueInbox } from "../lib/issueInbox";
import { normalizeRemote } from "../lib/projectExclusions";
import { fetchRegisteredGithubIssues, type GithubIssueFetchBatch } from "../repositories/katoSyncRepository";
import type { RegistryProject } from "../types";

function githubProject(project: RegistryProject): boolean {
  const url = normalizeRemote(project.remote);
  return Boolean(url && /^github\.com\/[a-z0-9-]+\/[a-z0-9_.-]+$/.test(url));
}

export function SecureBetaIssueInbox({ projects }: { projects: RegistryProject[] }) {
  const candidates = useMemo(() => projects.filter(githubProject), [projects]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [report, setReport] = useState<IssueInbox | null>(null);
  const [errors, setErrors] = useState<Array<{ repository: string; message: string }>>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const count = candidates.filter((p) => selected.includes(p.id)).length;

  function toggle(id: string) {
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((current) => current !== id) : [...previous, id]
    );
    // Previous results no longer substantiate the changed selection.
    setReport(null);
    setErrors([]);
    setFatalError(null);
  }

  async function runReadOnlyScan() {
    if (scanning) return;
    const chosen = candidates.filter((p) => selected.includes(p.id)).slice(0, 8);
    if (!chosen.length || chosen.length !== count) return;
    setScanning(true);
    setReport(null);
    setErrors([]);
    setFatalError(null);
    try {
      const batches: GithubIssueFetchBatch[] = await fetchRegisteredGithubIssues(chosen.map((p) => p.id));
      const failed = batches.filter((b) => b.error).map((b) => ({
        repository: normalizeRemote(b.remote)?.replace(/^github\.com\//, "") ?? "GitHub",
        message: b.error ?? "Unbekannter Abruffehler"
      }));
      const complete = batches.filter((b) => !b.error);
      const finishedAt = new Date().toISOString();
      const result = buildIssueInbox(chosen, complete.map((b) => ({ remote: b.remote, issues: b.issues })), finishedAt);
      setErrors(failed);
      setReport(result);
    } catch {
      // Do not expose rejected Tauri strings: they can contain local paths.
      setFatalError("GitHub-Scan konnte nicht gestartet werden. Prüfe KatoSync Desktop, deine Projekt-Registry und GitHub CLI.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <section className="glass agent-card" aria-label="Secure Beta Check – GitHub Issue Inbox">
      <div className="agent-card-title">
        <ShieldCheck size={18} />
        <h3>Secure Beta Check</h3>
      </div>
      <p className="agent-empty">
        GitHub-Issues deiner verknüpften Projekte prüfen – nur lesend, ohne Codeänderung.
        Befunde können später mit dem Projektgedächtnis und Agent Sync verbunden werden.
      </p>
      {!candidates.length ? (
        <p className="agent-empty">Noch kein GitHub-Projekt in der Project Registry. Füge zuerst ein Projekt hinzu.</p>
      ) : (
        <>
          <div className="projects-focus-list" role="group" aria-label="Repository-Auswahl für Secure Beta Check">
            {candidates.map((p) => (
              <label key={p.id} className="sbc-project-choice">
                <input type="checkbox" checked={selected.includes(p.id)}
                  disabled={scanning}
                  onChange={() => toggle(p.id)}
                />
                <strong>{p.name}</strong>
                <small>{normalizeRemote(p.remote)?.replace(/^github\.com\//, "")}</small>
                {p.scan?.headSha ? <small title={p.scan.headSha}><GitBranch size={12} /> {p.scan.headSha.slice(0, 7)}</small> : null}
              </label>
            ))}
          </div>
          <div className="sbc-controls">
            <button type="button" className="primary" disabled={scanning || count === 0 || count > 8}
              onClick={() => void runReadOnlyScan()}>
              {scanning ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
              {scanning ? "Prüfe GitHub-Issues…" : `GitHub-Issues prüfen (${count})`}
            </button>
            <small>Maximal 8 Projekte und 100 offene Issues pro Repo. Nur GitHub-CLI-Lesezugriff.</small>
          </div>
          {count > 8 ? <p className="tone-warn">Bitte maximal acht Projekte auswählen.</p> : null}
        </>
      )}

      {fatalError ? <p className="tone-warn" role="alert"><ShieldAlert size={15} /> {fatalError}</p> : null}
      {errors.map((error) => (
        <p key={error.repository} className="tone-warn" role="alert">
          <ShieldAlert size={15} /> {error.repository}: {error.message}
        </p>
      ))}

      {report ? (
        <div className="sbc-results" aria-live="polite">
          <div className="sbc-results-heading">
            <strong>Issue-Bericht – {report.entries.length} offene Issues gefunden</strong>
            <small>Abgerufen: {new Date(report.checkedAt).toLocaleString("de-DE")}</small>
          </div>
          <p className="agent-empty">
            <ShieldAlert size={14} /> Noch keine Beta-Freigabe: Dieser Durchlauf prüft nur GitHub-Issues,
            keine laufende Anwendung, Sicherheitsscans oder End-to-End-Tests.
          </p>
          {errors.length || report.unmatchedRepoCount || report.ambiguousRepoCount || report.invalidIssueCount ? (
            <p className="tone-warn">
              Unvollständige Evidenz: {errors.length} fehlgeschlagene Repos, {report.unmatchedRepoCount} unbekannte,
              {report.ambiguousRepoCount} mehrdeutige und {report.invalidIssueCount} ungültige Datensätze.
            </p>
          ) : null}
          {report.entries.length ? (
            <ul className="sbc-issues">
              {report.entries.map((issue) => (
                <li key={issue.key}>
                  <span className="projects-prio">{issue.priority}</span>
                  <div>
                    <strong>{issue.title}</strong>
                    <small>{issue.repository} #{issue.number} · {issue.securityRelated ? "Security-Review" : "Review nötig"}</small>
                    {issue.gitHead ? <small>Projektstand: {issue.gitHead.slice(0, 7)}</small> : <small>Projekt-Commit nicht verifiziert</small>}
                  </div>
                  <button type="button" className="ghost compact-button"
                    aria-label={`Issue ${issue.number} auf GitHub öffnen`}
                    onClick={() => { void openUrl(issue.url).catch(() => { setFatalError("GitHub-Issue konnte nicht im Browser geöffnet werden."); }); }}>
                    Ansehen
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="agent-empty"><Check size={15} /> Keine offenen Issues in den erfolgreich abgerufenen Repos beobachtet. Kein Beta-Ready-Nachweis.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
