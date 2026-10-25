// Created by NMKato Solutions
// Explicit single-job read-only MVP dispatcher. No writer or AutoLane invocation.
import {useEffect,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {CheckCircle2,Clock3,PlayCircle,ShieldCheck,AlertTriangle} from "lucide-react";
import {useT} from "../i18n";
import type {RegistryProject} from "../types";

type Preflight={ok:boolean;code:string};
type Proof={branch:string;head:string;clean:boolean;changedCount:number};
type Probe={
 id:string;provider:string;machine:string;project:string;startedAt:string;
 durationMs:number;status:"success"|"failed"|"timeout"|"changed";
 exitCode:number|null;before:Proof;after:Proof;reply:string;
};
export function ReadOnlyDispatchPanel({projects}: {projects:RegistryProject[]}){
 const {t}=useT();
 const [projectId,setProjectId]=useState("");
 const [provider,setProvider]=useState<"codex"|"claude">("codex");
 const [busy,setBusy]=useState(false);
 const [jobs,setJobs]=useState<Probe[]>([]);
 const [error,setError]=useState("");
 const [historyLoaded,setHistoryLoaded]=useState(false);
 const [historyError,setHistoryError]=useState(false);
 const [preflight,setPreflight]=useState<Preflight|null>(null);
 useEffect(()=>{
  let alive=true;
  invoke<Probe[]>("readonly_probe_history").then(rows=>{
   if(alive){setJobs(rows);setHistoryLoaded(true);}
  }).catch(()=>{if(alive){setHistoryError(true);setHistoryLoaded(true);}});
  return()=>{alive=false;};
 },[]);
 const selected=projects.find(p=>p.id===projectId);
 const safeError=(code:string)=>{
  switch(code){
   case "RO_AUTH": return t("readonly.errorAuth");
   case "RO_PROJECT": return t("readonly.errorProject");
   case "RO_REGISTRY": return t("readonly.errorRegistry");
   case "RO_GIT": return t("readonly.errorGit");
   case "RO_HISTORY": return t("readonly.errorHistory");
   case "RO_INPUT": return t("readonly.errorInput");
   case "RO_OK": return t("readonly.preflightOk");
   default: return t("readonly.error");
  }
 };
 async function check(){
  if(busy||!selected)return;
  setBusy(true);setError("");setPreflight(null);
  try{
   const result=await invoke<Preflight>("readonly_probe_preflight",{
    req:{provider,projectId:selected.id,repoPath:selected.rootPath}
   });
   setPreflight(result);
  }catch{setError(t("readonly.error"));}
  finally{setBusy(false);}
 }
 async function run(){
  if(busy||!selected)return;
  setBusy(true);setError("");
  try{
   const job=await invoke<Probe>("readonly_dispatch_probe",{
    req:{provider,projectId:selected.id,repoPath:selected.rootPath}
   });
   setJobs(prev=>[job,...prev.filter(x=>x.id!==job.id)].slice(0,12));
  }catch(cause){
   setError(safeError(String(cause)));
  }finally{setBusy(false);}
 }
 return <section className="glass agent-card readonly-dispatch" aria-label={t("readonly.title")}>
  <header>
   <div className="agent-card-title"><ShieldCheck size={19}/><h3>{t("readonly.title")}</h3></div>
   <p className="agent-route-note">{t("readonly.intro")}</p>
  </header>
  <div className="readonly-dispatch-controls">
   <label>{t("readonly.project")}
    <select value={projectId} onChange={e=>{setProjectId(e.target.value);setPreflight(null);setError("");}} disabled={busy}>
     <option value="">{t("readonly.choose")}</option>
     {projects.map(project=><option value={project.id} key={project.id}>{project.name}</option>)}
    </select>
   </label>
   <label>{t("readonly.provider")}
    <select value={provider} onChange={e=>{setProvider(e.target.value as "codex"|"claude");setPreflight(null);setError("");}} disabled={busy}>
     <option value="codex">OpenAI Codex</option>
     <option value="claude">Anthropic Claude Code</option>
    </select>
   </label>
   <button type="button" className="ghost compact-button"
    disabled={busy||!selected} onClick={()=>void check()}>
    <ShieldCheck size={15}/>{t("readonly.preflight")}
   </button>
   <button type="button" className="secondary compact-button"
    disabled={busy||!selected} onClick={()=>void run()}>
    <PlayCircle size={15}/>{busy?t("readonly.running"):t("readonly.run")}
   </button>
  </div>
  {preflight?<p role="status" className={preflight.ok?"tone-success":"tone-warn"}>
   {preflight.ok?<CheckCircle2 size={14}/>:<AlertTriangle size={14}/>}
   {safeError(preflight.code)}
  </p>:null}
  {error?<p role="alert" className="tone-warn"><AlertTriangle size={14}/>{error}</p>:null}
  {historyError?<p role="status" className="tone-warn">{t("readonly.historyUnavailable")}</p>:null}
  <p className="agent-empty"><ShieldCheck size={13}/>{t("readonly.safety")}</p>
  <div className="readonly-dispatch-jobs">
   <strong><Clock3 size={15}/>{t("readonly.history")}</strong>
   {!jobs.length?<p className="agent-empty">{historyLoaded?t("readonly.empty"):t("readonly.loading")}</p>:null}
   {jobs.map(job=><article className="readonly-dispatch-job" key={job.id}>
    <div className="readonly-dispatch-job-title">
     {job.status==="success"?<CheckCircle2 size={16} color="var(--ok)"/>:<AlertTriangle size={16} color="var(--warn)"/>}
     <strong>{job.project} · {job.provider}</strong>
     <span>{t(("readonly.status."+job.status) as "readonly.status.success")}</span>
    </div>
    <small><span>{job.id}</span> · {job.machine} · {(job.durationMs/1000).toFixed(1)}s · {job.startedAt}</small>
    <div className="readonly-dispatch-proof">
     <span>{t("readonly.branch")}: <code>{job.before.branch||"detached"}</code></span>
     <span>HEAD: <code title={job.before.head}>{job.before.head.slice(0,10)}</code></span>
     <span>{t("readonly.git")}: {job.before.clean?"clean":"dirty"} → {job.after.clean?"clean":"dirty"}</span>
     <span>{t("readonly.exit")}: {job.exitCode??"—"}</span>
    </div>
    <pre className="readonly-dispatch-output">{job.reply||t("readonly.noReply")}</pre>
   </article>)}
  </div>
 </section>;
}
