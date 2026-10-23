// Created by NMKato Solutions
// Operator-initiated GitHub read-only inventory; no login, mutation or automatic provision.
import {useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {RefreshCcw,ShieldCheck} from "lucide-react";
import {useT} from "../i18n";
import type {KickoffTicket} from "../lib/projectKickoff.ts";

interface IssueCandidate {featureId:string;number:number;title:string;url:string;state:string}
interface BoardCandidate {
  number:number;title:string;url:string;public:boolean;closed:boolean;
  possibleRepoMatch:boolean;providerId:string;
}
interface Discovery {
  projectId:string;
  repository:{fullName:string;visibility:"public"|"private";archived:boolean;hasIssues:boolean};
  observedGitHead:string;authSource:"existing_local_gh_cli";
  projectsStatus:"read"|"unavailable";projectsScanComplete:boolean;projectsTotal:number|null;
  boards:BoardCandidate[];issuesScanComplete:boolean;issueCandidates:IssueCandidate[];
  checkedFeatureIds:string[];remoteWritesPerformed:false;automaticCreationAllowed:false;
}
export function ProjectGithubDiscoveryPanel({enabled,projectId,registeredRepo,selectedRepo,tickets}:{
  enabled:boolean;projectId:string|null;registeredRepo:string;selectedRepo:string;
  tickets:KickoffTicket[];
}){
  const {t}=useT();
  const [data,setData]=useState<Discovery|null>(null);
  const [busy,setBusy]=useState(false);
  const [failed,setFailed]=useState(false);
  const [moreBoards,setMoreBoards]=useState(false);
  const revision=useRef(0);
  const fingerprint=enabled+"|"+projectId+"|"+selectedRepo+"|"+tickets.map(x=>x.featureId).join(",");
  useEffect(()=>{
    revision.current++;setData(null);setBusy(false);setFailed(false);setMoreBoards(false);
    return ()=>{revision.current++;};
  },[fingerprint]);
  const repoMatches=Boolean(registeredRepo) &&
    selectedRepo.trim().toLowerCase()===registeredRepo.toLowerCase();
  const allowed=enabled&&Boolean(projectId)&&repoMatches&&Boolean(window.__TAURI_INTERNALS__);
  async function discover(){
    if(!allowed||!projectId)return;
    const generation=++revision.current;
    setBusy(true);setFailed(false);setData(null);
    try{
      const result=await invoke<Discovery>("continuity_github_kickoff_discover",{
        projectId,featureIds:tickets.slice(0,12).map(x=>x.featureId)
      });
      if(generation!==revision.current)return;
      if(result.projectId!==projectId||result.remoteWritesPerformed!==false ||
         result.automaticCreationAllowed!==false||
         result.authSource!=="existing_local_gh_cli"||
         result.repository.fullName.toLowerCase()!==registeredRepo.toLowerCase()){
        setFailed(true);return;
      }
      setData(result);
    }catch{if(generation===revision.current)setFailed(true);}
    finally{if(generation===revision.current)setBusy(false);}
  }
  const suggested=data?.boards.filter(x=>x.possibleRepoMatch)||[];
  const unrelated=data?.boards.filter(x=>!x.possibleRepoMatch)||[];
  return <div className="kickoff-discovery">
    <div className="kickoff-discovery-head">
      <strong><ShieldCheck size={14}/>{t("kickoff.discoverTitle")}</strong>
      <button type="button" className="secondary compact-button"
        disabled={!allowed||busy} onClick={()=>void discover()}>
        <RefreshCcw size={13}/>{busy?t("kickoff.discoverChecking"):t("kickoff.discoverAction")}
      </button>
    </div>
    {!projectId?<small>{t("kickoff.discoverRegister")}</small>
      :!repoMatches?<small>{t("kickoff.discoverRepoMismatch")}</small>
        :!window.__TAURI_INTERNALS__?<small>{t("kickoff.discoverDesktop")}</small>:null}
    <small>{t("kickoff.discoverCli")}</small>
    {failed?<p role="alert" className="tone-warn">{t("kickoff.discoverUnavailable")}</p>:null}
    {data?<div className="kickoff-discovery-result">
      <strong>{data.repository.fullName} · {data.repository.visibility}</strong>
      <small>{t("kickoff.discoverHead")}: {data.observedGitHead.slice(0,12)}</small>
      {data.repository.visibility==="public"?<p className="tone-warn">{t("kickoff.discoverPublicWarning")}</p>:null}
      {data.repository.archived?<small className="tone-warn">{t("kickoff.discoverArchived")}</small>:null}
      <div>
        <strong>{t("kickoff.discoverBoards")}: {data.boards.length}</strong>
        {data.projectsStatus!=="read"?<p className="tone-warn">{t("kickoff.discoverBoardsUnavailable")}</p>:
          !data.projectsScanComplete?<p className="tone-warn">{t("kickoff.discoverPartial")}</p>:null}
        {suggested.length?<ul className="kickoff-discovery-list">
          {suggested.map(board=><li key={board.providerId}>
            <a href={board.url} target="_blank" rel="noopener noreferrer">{board.title}</a>
            <small>{board.public?t("kickoff.discoverPublic"):t("kickoff.discoverPrivate")}
              {" · "}{t("kickoff.discoverCandidate")}</small>
          </li>)}
        </ul>:data.projectsStatus==="read"?<small>{t("kickoff.discoverNoCandidate")}</small>:null}
        {unrelated.length?<button type="button" className="ghost compact-button"
          aria-expanded={moreBoards} onClick={()=>setMoreBoards(x=>!x)}>
          {t("kickoff.discoverOtherBoards",{count:unrelated.length})}
        </button>:null}
        {moreBoards?<ul className="kickoff-discovery-list">
          {unrelated.map(board=><li key={board.providerId}>
            <a href={board.url} target="_blank" rel="noopener noreferrer">{board.title}</a>
          </li>)}
        </ul>:null}
      </div>
      <div>
        <strong>{t("kickoff.discoverIssues")}: {data.issueCandidates.length}</strong>
        {!data.issuesScanComplete?<p className="tone-warn">{t("kickoff.discoverPartial")}</p>:null}
        {data.issueCandidates.length?<ul className="kickoff-discovery-list">
          {data.issueCandidates.map(issue=><li key={issue.number+":"+issue.featureId}>
            <a href={issue.url} target="_blank" rel="noopener noreferrer">
              #{issue.number} {issue.title}</a>
            <small>{issue.featureId} · {issue.state} · {t("kickoff.discoverCandidate")}</small>
          </li>)}
        </ul>:<small>{t("kickoff.discoverNoIssues")}</small>}
      </div>
      <p className="continuity-notice">{t("kickoff.discoverGuard")}</p>
    </div>:null}
  </div>;
}
