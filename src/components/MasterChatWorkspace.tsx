// Created by NMKato Solutions
// Master Chat MVP is a visible entrypoint to the existing project-scoped Memory Fabric Chat.
// An external GitHub issue is an explicit draft, never a tool instruction or a queued job.
import {BrainCircuit,FolderGit2,ShieldCheck} from "lucide-react";
import {useEffect,useState} from "react";
import {useT} from "../i18n";
import {matchingRegisteredProject,githubIssueChatQuestion,type GithubIssueHandoff} from "../lib/githubChatHandoff";
import {ContinuityLocalChatPanel} from "./ContinuityLocalChatPanel";
import type {RegistryProject} from "../types";

export function MasterChatWorkspace({projects,handoff,onProjects,onClearHandoff}:{
  projects:RegistryProject[];
  handoff:GithubIssueHandoff|null;
  onProjects:()=>void;
  onClearHandoff:()=>void;
}){
 const {t}=useT();
 const match=handoff?matchingRegisteredProject(projects,handoff.fullName):null;
 const [selected,setSelected]=useState("");
 useEffect(()=>{
  if(handoff)setSelected(match??"");
 },[handoff?.revision,match]);
 const project=projects.find(p=>p.id===selected)??null;
 // Never place a GitHub issue in an unrelated local Memory Fabric project.
 const acceptedHandoff=handoff&&match===selected?handoff:null;
 return <section className="agent-master-chat" id="section-agent-master-chat">
  <header className="glass agent-card master-chat-head">
   <div className="agent-card-title"><BrainCircuit size={20}/><h2>{t("masterChat.title")}</h2></div>
   <p className="agent-empty">{t("masterChat.subtitle")}</p>
   <p className="continuity-notice"><ShieldCheck size={15}/>{t("masterChat.safety")}</p>
  </header>
  {handoff?<section className="glass agent-card master-chat-handoff" aria-label={t("masterChat.handoff")}>
   <strong><FolderGit2 size={16}/>{t("masterChat.handoff")}</strong>
   <p>{handoff.fullName} · #{handoff.number} — {handoff.title}</p>
   {!match?<p className="tone-warn" role="alert">{t("masterChat.unmatched")}</p>
    :<p className="agent-empty">{t("masterChat.matched")}</p>}
   <small>{t("masterChat.reviewOnly")}</small>
   <button className="ghost compact-button" type="button" onClick={onClearHandoff}>
    {t("masterChat.clearDraft")}
   </button>
  </section>:null}
  <section className="glass agent-card master-chat-project">
   <label className="projects-select">
    <span>{t("masterChat.select")}</span>
    <select value={selected} onChange={e=>setSelected(e.target.value)}
     disabled={Boolean(handoff)}>
     <option value="">{t("masterChat.choose")}</option>
     {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
   </label>
   {handoff&&!match?<button className="secondary compact-button" type="button" onClick={onProjects}>
    <FolderGit2 size={14}/>{t("masterChat.openProjects")}
   </button>:null}
   {!projects.length?<p className="agent-empty">{t("masterChat.noProjects")}</p>:null}
   {project?<ContinuityLocalChatPanel
     key={project.id}
     projectId={project.id}
     projectName={project.name}
     initialDraft={acceptedHandoff?githubIssueChatQuestion(acceptedHandoff):""}
     draftRevision={acceptedHandoff?.revision??0}
   />:null}
   {handoff&&!match?<p className="agent-empty">{t("masterChat.copyInstead")}</p>:null}
  </section>
 </section>;
}
