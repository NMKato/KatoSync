// Created by NMKato Solutions
// Charts show only existing provider, job and Git-scan evidence. No invented push times.
import { Activity, ArrowUpRight, GitCommitHorizontal, RadioTower, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { useT } from "../i18n";
import { buildOperationalEvidence } from "../lib/operationalEvidence40";
import { uxCopy } from "../lib/uxCopy40";
import type { useKatoSyncViewModel, StepId } from "../viewmodels/useKatoSyncViewModel";

type VM = ReturnType<typeof useKatoSyncViewModel>;
type Navigate = (step: StepId) => void;

export function OperationalEvidenceDashboard({
  vm,
  onNavigate,
  presentation = false
}: {
  vm: VM;
  onNavigate: Navigate;
  presentation?: boolean;
}) {
  const { lang } = useT();
  const copy = uxCopy(lang);
  const evidence = useMemo(
    () => buildOperationalEvidence({
      events: vm.agentSync.events,
      transitions: vm.providerHistory,
      projects: vm.projects.loaded ? vm.projects.registry.projects : [],
      statuses: vm.providerStatuses
    }),
    [vm.agentSync.events, vm.providerHistory, vm.projects.loaded, vm.projects.registry.projects, vm.providerStatuses]
  );
  const max = Math.max(1, ...evidence.days.flatMap((day) => [day.jobs, day.transitions]));
  const total = evidence.providers.total;
  const fraction = total > 0 ? evidence.providers.available / total : 0;
  const arc = 2 * Math.PI * 40;
  const dateFormatter = new Intl.DateTimeFormat(lang, { day: "2-digit", month: "short", year: "numeric" });

  return (
    <section className="ks40-evidence" aria-labelledby="ks40-evidence-title">
      <header className="ks40-section-heading">
        <div>
          <span className="ks40-eyebrow"><Activity size={14} /> {copy.evidenceEyebrow}</span>
          <h2 id="ks40-evidence-title">{copy.evidenceTitle}</h2>
          <p>{copy.evidenceHint}</p>
        </div>
      </header>
      <div className="ks40-evidence-grid">
        <article className="ks40-evidence-panel ks40-evidence-health">
          <header>
            <ShieldCheck size={18} />
            <h3>{copy.evidenceProviders}</h3>
          </header>
          <div className="ks40-donut-row">
            <svg viewBox="0 0 112 112" className="ks40-donut" role="img" aria-label={copy.evidenceProviders + ": " + evidence.providers.available + " / " + total}>
              <circle cx="56" cy="56" r="40" className="ks40-donut-track" fill="none" strokeWidth="10" />
              <circle cx="56" cy="56" r="40" className="ks40-donut-value" fill="none" strokeWidth="10"
                strokeDasharray={String(arc * fraction) + " " + String(arc)}
                transform="rotate(-90 56 56)" />
              <text x="56" y="54" textAnchor="middle" className="ks40-donut-count">{evidence.providers.available}/{total}</text>
              <text x="56" y="71" textAnchor="middle" className="ks40-donut-sub">Cloud</text>
            </svg>
            <div className="ks40-donut-detail">
              <strong>{copy.evidenceProviders}</strong>
              <p>{copy.evidenceNotMesh}</p>
              <div className="ks40-service-logos" aria-label="OpenAI Codex / Anthropic Claude">
                <img src="/agent-openai.png" alt="OpenAI" />
                <img src="/agent-claude.png" alt="Anthropic" />
              </div>
            </div>
          </div>
          <button className="ks40-text-action" type="button" onClick={() => onNavigate("agentProviders")}>
            {copy.evidenceConnections} <ArrowUpRight size={15} />
          </button>
        </article>
        <article className="ks40-evidence-panel ks40-evidence-activity">
          <header>
            <RadioTower size={18} />
            <h3>{copy.evidenceEvents}</h3>
          </header>
          <div className="ks40-activity-legend" aria-hidden="true">
            <span className="jobs">{copy.evidenceJobEvents}: {evidence.totalJobEvents}</span>
            <span className="transitions">{copy.evidenceTransitions}: {evidence.totalTransitions}</span>
          </div>
          {evidence.hasEvents ? (
            <div className="ks40-activity-bars" role="img" aria-label={copy.evidenceEvents + ": " + evidence.totalJobEvents + " " + copy.evidenceJobEvents + ", " + evidence.totalTransitions + " " + copy.evidenceTransitions}>
              {evidence.days.map((day) => (
                <div className="ks40-bar-day" key={day.key}>
                  <div className="ks40-bar-pair">
                    <span className="ks40-bar jobs" style={{ height: (day.jobs ? Math.max(6, day.jobs / max * 100) : 0) + "%" }} />
                    <span className="ks40-bar transitions" style={{ height: (day.transitions ? Math.max(6, day.transitions / max * 100) : 0) + "%" }} />
                  </div>
                  <small>{day.day}</small>
                  <span className="ks40-visually-hidden">{copy.evidenceDay} {day.key}: {day.jobs} {copy.evidenceJob}, {day.transitions} {copy.evidenceProvider}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="ks40-no-evidence">{copy.evidenceEmpty}</div>
          )}
          <small className="ks40-source-note">{copy.evidenceHint}</small>
        </article>
        <article className="ks40-evidence-panel ks40-evidence-commits">
          <header>
            <GitCommitHorizontal size={18} />
            <h3>{copy.evidenceCommits}</h3>
          </header>
          <p className="ks40-source-note">{copy.evidenceCommitHint}</p>
          {evidence.commits.length ? (
            <ol className="ks40-commit-list">
              {evidence.commits.map((commit, index) => (
                <li key={commit.id}>
                  <span className={"ks40-commit-dot " + commit.state} />
                  <span className="ks40-commit-main">
                    <strong>{presentation ? "Projekt " + (index + 1) : commit.name}</strong>
                    <small>{presentation ? "••••••••" : commit.shortSha} · {commit.state === "verified" ? "HEAD ✓" : copy.evidenceStale}</small>
                  </span>
                  <time dateTime={commit.at}>{dateFormatter.format(new Date(commit.at))}</time>
                </li>
              ))}
            </ol>
          ) : (
            <div className="ks40-no-evidence">{copy.evidenceCommitEmpty}</div>
          )}
          <button className="ks40-text-action" type="button" onClick={() => onNavigate("agentProjects")}>
            {copy.evidenceProjects} <ArrowUpRight size={15} />
          </button>
        </article>
      </div>
    </section>
  );
}
