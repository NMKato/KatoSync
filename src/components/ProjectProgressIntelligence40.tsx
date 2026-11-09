// KatoSync 4.0 — honest Roadmap × Repository × Jobs progress intelligence.
// No fake ETA: forecast requires real acceptance history, not commit counts or claims.
import {useEffect,useMemo,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {Activity,AlertTriangle,CalendarClock,ChevronDown,GitBranch,RefreshCcw,ShieldCheck,Workflow} from "lucide-react";
import {
  computeSmartProjectProgress40,type ForecastResult40,type RepoEvidence40
} from "../lib/smartProjectProgress40.ts";
import type {AgentJob,RegistryProject} from "../types.ts";
import type {ProjectMvpProgress} from "./ProjectMvpIndicator.tsx";

const repoLabel:Record<RepoEvidence40,string>={
  consistent:"Git-Stand und Dokumentprüfung konsistent",
  stale:"Repository-Prüfung veraltet",
  dirty:"Lokale Änderungen im Arbeitsbaum",
  conflict:"Git-HEAD und Dokumentprüfung weichen ab",
  unknown:"Noch keine belastbare Repository-Prüfung"
};
const reasonLabel:Record<Extract<ForecastResult40,{status:"unavailable"}>["reason"],string>={
  no_verified_progress:"Noch keine unabhängig bestätigten Feature-Abnahmen",
  insufficient_history:"Mindestens drei datierte Abnahmen über sieben Tage erforderlich",
  history_outdated:"Letzte bestätigte Abnahme ist veraltet",
  blocked:"Offene Blocker verhindern eine belastbare Prognose",
  scope_changed:"Roadmap oder Abnahmebasis wurde geändert",
  rate_unreliable:"Entwicklungstempo derzeit nicht stabil genug",
  already_complete:"Vollständige Abnahme erreicht"
};
const laneLabel:Record<string,string>={
  codex:"Codex",claude:"Claude",local:"Lokaler Agent",
  remote_orchestrator:"Remote-Orchestrator",local_control:"Local Control"
};
export function ProjectProgressIntelligence40({
  project,jobs
}:{
  project:RegistryProject;
  jobs:readonly AgentJob[];
}){
  const [progress,setProgress]=useState<ProjectMvpProgress|null>(null);
  const [fetchError,setFetchError]=useState(false);
  const [loading,setLoading]=useState(false);
  const [nowMs,setNowMs]=useState(()=>Date.now());
  const seq=useRef(0);
  const currentProject=useRef(project.id);
  currentProject.current=project.id;

  async function refresh(){
    const request=++seq.current;
    setProgress(null);
    setFetchError(false);
    setLoading(true);
    try{
      if(!window.__TAURI_INTERNALS__)throw Error("desktop_only");
      const next=await invoke<ProjectMvpProgress>("continuity_mvp_progress",{projectId:project.id});
      if(seq.current!==request||currentProject.current!==project.id)return;
      if(next.projectId!==project.id||
         (next.verifiedPercent!==null&&next.verifiedPercent!==undefined&&
          (!Number.isInteger(next.verifiedPercent)||next.verifiedPercent<0||
            next.verifiedPercent>100))){
        throw Error("invalid_report");
      }
      setProgress(next);
      setNowMs(Date.now());
    }catch{
      if(seq.current===request)setFetchError(true);
    }finally{
      if(seq.current===request)setLoading(false);
    }
  }
  useEffect(()=>{
    void refresh();
    return()=>{seq.current+=1;};
    // Keep project-scoped changes atomic; manual refresh for new roadmap baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[project.id]);
  useEffect(()=>{
    const tick=window.setInterval(()=>setNowMs(Date.now()),30_000);
    return()=>window.clearInterval(tick);
  },[]);
  const report=useMemo(()=>computeSmartProjectProgress40({
    project,progress,jobs,nowMs
  }),[project,progress,jobs,nowMs]);
  const claimed=report.reportedPercent;
  const forecast=report.forecast;
  const forecastText=forecast.status==="range"
    ? `${new Date(forecast.earliest+"T12:00:00Z").toLocaleDateString("de-DE")} – ${new Date(forecast.latest+"T12:00:00Z").toLocaleDateString("de-DE")}`
    :reasonLabel[forecast.reason];

  return <section className="glass smart-project-status" aria-label="Intelligenter Projektstatus">
    <header className="smart-project-status-top">
      <div>
        <div className="smart-project-status-title"><Activity size={17}/><h4>Projektstatus · Smart Flow</h4></div>
        <small>Roadmap × Git-Stand × echte Arbeitsmeldungen</small>
      </div>
      <button type="button" className="ghost compact-button" disabled={loading}
        onClick={()=>void refresh()}><RefreshCcw size={13}/>{loading?"Lädt …":"Aktualisieren"}</button>
    </header>
    {fetchError?<p role="status" className="tone-warn">
      Roadmap-Abfrage nicht verfügbar. Die Repository- und Jobhinweise bleiben getrennt sichtbar.
    </p>:null}
    <div className="smart-project-progress-meter">
      <div className="smart-project-meter-head">
        <strong>{claimed===null?"Roadmap-Fortschritt nicht konfiguriert":`${claimed} % gemeldeter Fortschritt`}</strong>
        <small>Unabhängig abgenommen: {report.verifiedPercent===null?"noch nicht bestimmbar":`${report.verifiedPercent} %`}</small>
      </div>
      <div className="smart-project-progress-track" role={claimed===null?"img":"progressbar"}
        aria-label="Gemeldeter Roadmap-Fortschritt, nicht verifiziert"
        aria-valuemin={claimed===null?undefined:0}
        aria-valuemax={claimed===null?undefined:100}
        aria-valuenow={claimed===null?undefined:claimed}>
        <span style={{width:`${claimed??0}%`}}/>
      </div>
      <small className="smart-project-data-caveat">
        Git-Commits oder erfolgreiche Buildtests gelten nicht automatisch als abgeschlossene Funktionen.
        {" "}{report.claimedTests.pass} gemeldete Test-Erfolge, {report.claimedTests.fail} Fehler,
        {" "}{report.claimedTests.stale} veraltete oder nicht gebundene Nachweise.
      </small>
    </div>

    {report.documentedFocus?<div className="smart-project-current-wave">
      <strong>Dokumentierter Arbeitsfokus</strong>
      <span>{report.documentedFocus}</span>
      <small>{report.currentWaveSource==="code_truth"?"Aus Code-/Repo-Prüfung":
        report.currentWaveSource==="documented"?"Aus Status-/Projektdatei":"Quelle nicht gesichert"} ·
        {" "}{report.statusDocumentCount} Status- oder Handoff-Dokumente erfasst</small>
    </div>:null}
    <div className="smart-project-facts">
      <div><GitBranch size={15}/><span><strong>Repository</strong>
        <small>{repoLabel[report.repoEvidence]}</small>
        {report.repoHead?<code>{report.repoHead.slice(0,10)}</code>:null}</span></div>
      <div><Workflow size={15}/><span><strong>Aktive Arbeiten</strong>
        <small>{report.activeJobs.filter(job=>job.status==="running"&&job.fresh).length} live bestätigt ·
          {" "}{report.activeJobs.filter(job=>job.status==="running"&&!job.fresh).length} ohne aktuelle Meldung</small></span></div>
      <div><AlertTriangle size={15}/><span><strong>Offene Prüfhinweise</strong>
        <small>{report.repositoryFindings} Repository · {report.roadmapBlockers} Roadmap-Blocker</small></span></div>
    </div>

    <section className="smart-project-forecast" aria-label="Abschlussprognose">
      <div><CalendarClock size={16}/><strong>Voraussichtlicher Abschluss</strong></div>
      <strong className={forecast.status==="range"?"":"smart-project-forecast-pending"}>{forecastText}</strong>
      <small>{forecast.status==="range"
        ?`Statistische Szenariospanne · ${forecast.samples} bestätigte Abnahmen / ${forecast.measuredDays} Tage · ${forecast.confidence==="low"?"geringe":"mittlere"} Aussagekraft · bei ähnlichem Tempo und ohne neue Blocker`
        :"Keine künstliche Terminangabe. Die Prognose wird erst bei ausreichender, unabhängiger Abnahmehistorie aktiviert."}</small>
    </section>

    {report.nextRoadmapMilestones.length||report.nextSafeActions.length?
      <section className="smart-project-next-milestones" aria-label="Nächster Roadmap-Schritt">
        <strong>Als Nächstes laut Projektplan</strong>
        {report.nextRoadmapMilestones.length?<ol>{report.nextRoadmapMilestones.map(step=>
          <li key={step.id}><span>{step.title}</span>
            <small>{step.reportedStatus==="claimed_blocked"?"Als blockiert gemeldet":
              step.reportedStatus==="claimed_in_progress"?"Als in Arbeit gemeldet":
                "Noch nicht als abgeschlossen gemeldet"}</small></li>)}</ol>
        :<ol>{report.nextSafeActions.map((item,index)=>
          <li key={index}><span>{item}</span><small>Dokumentierter nächster Arbeitsschritt</small></li>)}</ol>}
      </section>:null}
    {report.activeJobs.length?<div className="smart-project-job-list">
      <strong>Woran arbeitet KatoSync?</strong>
      <ul>{report.activeJobs.map(job=><li key={job.jobId}>
        <span className={job.status==="running"&&job.fresh?"smart-project-live-dot":"smart-project-idle-dot"}/>
        <div><strong>{laneLabel[job.owner??""]??"Noch kein bestätigter Besitzer"}</strong>
          <small>{job.status} · {job.phase||"keine Phase"} · {job.fresh?"aktuelle Meldung":"nicht live bestätigt"}</small>
          <span>{job.title}</span></div>
      </li>)}</ul>
    </div>:<p className="smart-project-empty">Momentan ist kein projektgebundener Job als aktiv belegt.</p>}

    <details className="smart-project-evidence">
      <summary><ShieldCheck size={14}/> Berechnungsgrundlagen und Quellen <ChevronDown size={14}/></summary>
      <ul>{report.sourceNotes.map(note=><li key={note}>{note}</li>)}</ul>
      <p>Aktueller Roadmap-Scope: {report.scope==="configured"?"importiert, noch nicht unabhängig bestätigt":"noch nicht eingerichtet"}.
        {report.openTaskCount>0?` ${report.openTaskCount} gemeldete MVP-Aufgaben sind offen.`:""}
      </p>
    </details>
  </section>;
}
