// Created by NMKato Solutions
// Progressive disclosure: top 3 project MVP bars + scroll-limited overflow + one scoped dossier.
import { useState } from "react";
import { ChevronDown, ChevronRight, FolderGit2, ListChecks, X } from "lucide-react";
import { useT } from "../i18n";
import { partitionMvpDashboard } from "../lib/mvpDashboardLayout.ts";
import type { RegistryProject } from "../types";
import { ProjectMvpIndicator } from "./ProjectMvpIndicator";

export function ProjectMvpPortfolio({projects}: {projects:readonly RegistryProject[]}) {
  const {t}=useT();
  const [more,setMore]=useState(false);
  const [opened,setOpened]=useState<string|null>(null);
  const {top,rest}=partitionMvpDashboard(projects);
  const all=[...top,...rest];
  const selected=all.find(project=>project.id===opened);
  if (!all.length) return null;

  function choose(id:string) {
    setOpened(previous=>previous===id?null:id);
  }

  return <section className="glass agent-card mvp-dashboard" aria-label={t("mvp.portfolio")}>
    <header className="mvp-portfolio-head">
      <div>
        <div className="agent-card-title"><ListChecks size={17}/><h3>{t("mvp.portfolio")}</h3></div>
        <p className="agent-empty">{t("mvp.portfolioCompactHint")}</p>
      </div>
      <small>{t("mvp.priorityRule")}</small>
    </header>

    <div className="mvp-dashboard-grid">
      {top.map(project=><article className="mvp-dashboard-project" key={project.id}>
        <div className="mvp-project-head">
          <strong>{project.name}</strong>
          <small>{project.focus.priority}</small>
        </div>
        <ProjectMvpIndicator projectId={project.id} compact />
        {project.verification?.findings.filter(f => !f.resolved && (f.severity === "warn" || f.severity === "danger")).length ? (
          <small className="tone-warn mvp-attention-hint">{t("mvp.openFindings", {
            count: project.verification.findings.filter(f => !f.resolved && (f.severity === "warn" || f.severity === "danger")).length
          })}</small>
        ) : null}
        <button type="button" className="ghost compact-button mvp-open-project"
          aria-expanded={opened===project.id}
          onClick={()=>choose(project.id)}>
          {opened===project.id?t("mvp.closeProject"):t("mvp.openProject")}
          <ChevronRight size={13}/>
        </button>
      </article>)}
    </div>

    {rest.length>0?<div className="mvp-overflow">
      <button className="mvp-overflow-trigger ghost" type="button"
        aria-expanded={more} aria-controls="mvp-overflow-list"
        onClick={()=>setMore(current=>!current)}>
        {more?<ChevronDown size={16}/>:<ChevronRight size={16}/>}
        <span>{t("mvp.moreProjects")} ({rest.length})</span>
      </button>
      {more?<div id="mvp-overflow-list" className="mvp-overflow-scroll" role="region"
        aria-label={t("mvp.moreProjects")} tabIndex={0}>
        <ul className="mvp-overflow-list">
          {rest.map(project=><li key={project.id}>
            <button type="button" className="mvp-overflow-project"
              aria-expanded={opened===project.id}
              onClick={()=>choose(project.id)}>
              <span className="mvp-overflow-project-copy">
                <strong>{project.name}</strong>
                <small>{project.focus.priority} · {t(project.focus.status==="active"
                  ?"mvp.statusActive":project.focus.status==="parked"
                    ?"mvp.statusParked":"mvp.statusArchived")}</small>
              </span>
              <ChevronRight size={15}/>
            </button>
          </li>)}
        </ul>
      </div>:null}
    </div>:null}

    {selected?<section className="mvp-project-dossier" aria-label={t("mvp.projectDetails")}>
      <div className="mvp-dossier-head">
        <div><div className="agent-card-title"><FolderGit2 size={16}/>
          <h4>{selected.name} · {t("mvp.projectDetails")}</h4></div>
          <small>{selected.focus.priority} · {selected.focus.status} · {selected.id}</small>
        </div>
        <button type="button" className="ghost compact-button"
          onClick={()=>setOpened(null)} aria-label={t("mvp.closeProject")}>
          <X size={16}/>{t("mvp.closeProject")}
        </button>
      </div>

      <ProjectMvpIndicator key={selected.id} projectId={selected.id} defaultExpanded />

      <details className="mvp-dossier-section">
        <summary>{t("mvp.flowDetails")}</summary>
        <p><strong>{t("mvp.currentWave")}:</strong> {selected.capsule?.currentWave.text ?? t("mvp.noCurrentWave")}</p>
        <p><strong>{t("mvp.verificationState")}:</strong> {selected.verification?.state ?? "unscanned"}</p>
        <small>{t("mvp.lastScan")}: {selected.scan?.scannedAt ?? t("mvp.noScan")}</small>
        {selected.verification?.findings.length ? <ul>
          {selected.verification.findings.slice(0,8).map(finding=>
            <li key={finding.id}>{finding.resolved?"✓":"•"} {finding.detail}</li>
          )}
        </ul>:null}
        <p className="mvp-verified-notice">{t("mvp.scanCaveat")}</p>
      </details>

      <details className="mvp-dossier-section">
        <summary>{t("mvp.contextDetails")}</summary>
        {selected.capsule?<div className="mvp-context-summary">
          {selected.capsule.purpose?<p>{selected.capsule.purpose}</p>:null}
          {selected.capsule.nextSafeWork.length?<><strong>{t("mvp.nextActions")}</strong>
            <ol>{selected.capsule.nextSafeWork.slice(0,8).map((entry,i)=><li key={i}>{entry}</li>)}</ol>
          </>:<small>{t("mvp.noNextActions")}</small>}
          {selected.capsule.sources.length?<small>{t("mvp.sourceCount")}: {selected.capsule.sources.length}</small>:null}
        </div>:<p className="agent-empty">{t("mvp.contextUnavailable")}</p>}
      </details>
    </section>:null}
  </section>;
}
