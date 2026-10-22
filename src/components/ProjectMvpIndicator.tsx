// Created by NMKato Solutions
// Read-only project MVP plan overview. Unverified claims never imply verified release progress.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Flag, RefreshCcw } from "lucide-react";
import { useT } from "../i18n";
export type MvpScopeTask = {
  featureId:string; title:string; lane:"mvp"|"side";weight:number;acceptanceCriteria:string;
  reportedStatus:string;statusJournalSequence:number|null;verified:boolean;
};
export type ProjectMvpProgress = {
  projectId:string;planJournalSequence:number|null;planStatus:string;
  mvpTaskCount:number;sideTaskCount:number;totalWeight:number;reportedDoneWeight:number;
  reportedPercent:number|null;verifiedPercent:number|null;tasks:MvpScopeTask[];
};

export function ProjectMvpIndicator({projectId,compact=false}:{projectId:string;compact?:boolean}) {
  const {t}=useT();
  const [data,setData]=useState<ProjectMvpProgress|null>(null);
  const [unavailable,setUnavailable]=useState(false);
  const [loading,setLoading]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const request=useRef(0);
  const selected=useRef(projectId);
  selected.current=projectId;
  async function read(){
    const generation=++request.current;
    setData(null);setUnavailable(false);
    if(!projectId || !window.__TAURI_INTERNALS__)return;
    setLoading(true);
    try{
      const value=await invoke<ProjectMvpProgress>("continuity_mvp_progress",{projectId});
      if(generation!==request.current || selected.current!==projectId)return;
      if(value.projectId!==projectId || value.verifiedPercent!==null ||
         (value.reportedPercent!==null && (value.reportedPercent<0||value.reportedPercent>100))){
        setUnavailable(true);return;
      }
      setData(value);
    }catch{if(generation===request.current)setUnavailable(true);}
    finally{if(generation===request.current)setLoading(false);}
  }
  useEffect(()=>{
    void read();
    return ()=>{request.current+=1;};
    // Explicit project switch refreshes; operator can refresh after new checkpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[projectId]);
  const configured=data && data.planStatus==="imported_unverified" &&
     data.mvpTaskCount>0 && data.reportedPercent!==null;
  const reported=configured?data.reportedPercent:null;
  const label=reported===null?t("mvp.notConfigured"):String(reported)+"% "+t("mvp.reported");
  return <section className={"mvp-indicator"+(compact?" compact":"")}
    aria-label={t("mvp.title")+": "+label}>
    <div className="mvp-top">
      <span><Flag size={13}/><strong>{t("mvp.title")}</strong></span>
      {!compact?<button type="button" className="ghost compact-button" disabled={loading}
        onClick={()=>void read()}><RefreshCcw size={12}/>{t("mvp.refresh")}</button>:null}
    </div>
    {!window.__TAURI_INTERNALS__?<small className="mvp-verified-notice">{t("mvp.desktopOnly")}</small>:null}
    {loading?<small role="status">{t("mvp.loading")}</small>:null}
    {unavailable?<small role="status" className="tone-warn">{t("mvp.unavailable")}</small>:null}
    {!loading&&!unavailable&&Boolean(window.__TAURI_INTERNALS__)?<>
      <div className={"mvp-track"+(reported===null?" unconfigured":"")}
        role={reported===null?"img":"progressbar"} aria-label={t("mvp.reportedBar")}
        aria-valuenow={reported===null?undefined:reported} aria-valuemin={reported===null?undefined:0}
        aria-valuemax={reported===null?undefined:100}>
        <span style={{width:String(reported??0)+"%"}}/>
      </div>
      <div className="mvp-meta">
        <strong>{label}</strong>
        {data?.mvpTaskCount?<small>{data.mvpTaskCount} {t("mvp.goals")}</small>:null}
        {data?.sideTaskCount?<small>{data.sideTaskCount} {t("mvp.side")}</small>:null}
      </div>
      <small className="mvp-verified-notice">{t("mvp.notVerified")}</small>
      {!compact&&data&&data.tasks.length>0?<>
        <button type="button" className="ghost compact-button" aria-expanded={expanded}
          onClick={()=>setExpanded(x=>!x)}>{expanded?t("mvp.hide"):t("mvp.details")}</button>
        {expanded?<ul className="mvp-task-list">{data.tasks.map(task=><li key={task.featureId}>
          <strong>{task.title}</strong>
          <small>{task.featureId} · {task.lane==="mvp"?t("mvp.title"):t("mvp.side")} · {t("mvp.weight")} {task.weight}</small>
          <small>{t("mvp.acceptance")}: {task.acceptanceCriteria}</small>
          <small>{task.reportedStatus==="claimed_done"?t("mvp.claimedDone"):t("mvp.open")}</small>
        </li>)}</ul>:null}
      </>:null}
    </>:null}
  </section>;
}
