// Created by NMKato Solutions
// Optional local-first project start. No GitHub connection, provisioning or implicit consent.
import {useMemo,useState} from "react";
import {ClipboardCopy,GitBranch,ShieldCheck} from "lucide-react";
import {useT} from "../i18n";
import {normalizeRemote} from "../lib/projectExclusions.ts";
import {buildProjectKickoff,type KickoffScope} from "../lib/projectKickoff.ts";
import type {ContinuityBlueprintPreview} from "../lib/continuityBlueprint.ts";
import type {RegistryProject} from "../types";

export function ProjectKickoffWizard({project,blueprint}:{
  project?:RegistryProject|null;blueprint?:ContinuityBlueprintPreview|null
}) {
  const {t}=useT();
  const remote=normalizeRemote(project?.remote);
  const initialRepo=remote?.startsWith("github.com/")?remote.slice("github.com/".length):"";
  const [title,setTitle]=useState(blueprint?.title??project?.name??"");
  const [intent,setIntent]=useState(blueprint?.intent??"");
  const [scope,setScope]=useState<KickoffScope>("product");
  const [useGithub,setUseGithub]=useState(false);
  const [repository,setRepository]=useState(initialRepo);
  const [copied,setCopied]=useState(false);
  const proposal=useMemo(()=>{
    try {
      return buildProjectKickoff({
        title,intent,scope,githubEnabled:useGithub,
        existingRepository:repository||null,blueprint
      });
    }catch{return null;}
  },[title,intent,scope,useGithub,repository,blueprint]);
  async function copy(){
    if(!proposal)return;
    setCopied(false);
    try{
      await navigator.clipboard.writeText(JSON.stringify(proposal,null,2));
      setCopied(true);
    }catch{setCopied(false);}
  }
  return <details className="project-kickoff" >
    <summary><GitBranch size={16}/>{t("kickoff.title")}</summary>
    <div className="project-kickoff-body">
      <p className="agent-empty">{t("kickoff.subtitle")}</p>
      <div className="project-kickoff-fields">
        <label>{t("kickoff.projectName")}
          <input value={title} maxLength={120} onChange={e=>{setTitle(e.target.value);setCopied(false);}}/>
        </label>
        <label>{t("kickoff.scope")}
          <select value={scope} onChange={e=>{setScope(e.target.value as KickoffScope);setCopied(false);}}>
            <option value="product">{t("kickoff.product")}</option>
            <option value="feature">{t("kickoff.feature")}</option>
          </select>
        </label>
        <label className="project-kickoff-intent">{t("kickoff.goal")}
          <textarea rows={2} maxLength={700} value={intent}
            onChange={e=>{setIntent(e.target.value);setCopied(false);}}
            placeholder={t("kickoff.goalPlaceholder")}/>
        </label>
      </div>
      <label className="project-kickoff-optin">
        <input type="checkbox" checked={useGithub}
          onChange={e=>{setUseGithub(e.target.checked);setCopied(false);}}/>
        {t("kickoff.githubOptional")}
      </label>
      {useGithub?<div className="project-kickoff-github">
        <label>{t("kickoff.existingRepo")}
          <input value={repository} maxLength={200} spellCheck={false}
            onChange={e=>{setRepository(e.target.value);setCopied(false);}}
            placeholder="owner/repository"/>
        </label>
        <small>{t("kickoff.privateFirst")}</small>
        <small>{t("kickoff.connectionPending")}</small>
      </div>:<p className="project-kickoff-local"><ShieldCheck size={14}/>{t("kickoff.localFirst")}</p>}
      {!proposal?<p className="tone-warn" role="alert">{t("kickoff.invalid")}</p>:<>
        <div className="project-kickoff-summary">
          <strong>{proposal.mode==="local_only"?t("kickoff.localPlan")
            :proposal.mode==="reuse_repository"?t("kickoff.reuseRepo")
              :proposal.mode==="needs_repository_selection"?t("kickoff.chooseRepo")
                :t("kickoff.proposeRepo")}</strong>
          {proposal.repositoryProposal?<small>{t("kickoff.suggestedRepo")}: {proposal.repositoryProposal}</small>:null}
          <small>{proposal.existingRepository??t("kickoff.noRemote")}</small>
          <small>{t("kickoff.board")}: {proposal.board==="none"?t("kickoff.localBoard")
            :proposal.board==="after_repository_selection"?t("kickoff.boardAfterRepo")
              :t("kickoff.oneBoard")}</small>
        </div>
        <p className="agent-empty">{t("kickoff.columns")}: {proposal.statuses.join(" → ")}</p>
        <div className="project-kickoff-ticket-summary">
          <strong>{t("kickoff.proposedIssues")} ({proposal.tickets.length})</strong>
          <small>{t("kickoff.notCreated")}</small>
        </div>
        <ol className="project-kickoff-tickets">
          {proposal.tickets.map(ticket=><li key={ticket.featureId}>
            <strong>{ticket.title}</strong>
            <small>{ticket.featureId} · {ticket.lane==="mvp"?t("kickoff.mvp"):t("kickoff.side")}</small>
            <small>{ticket.acceptanceCriteria}</small>
          </li>)}
        </ol>
        {proposal.remainingTasksNotIncluded>0?<small>{t("kickoff.moreDeferred",{count:proposal.remainingTasksNotIncluded})}</small>:null}
        <details className="project-kickoff-checklist">
          <summary>{t("kickoff.checklist")}</summary>
          <ol>
            {proposal.setupChecklist.map(step=><li key={step}>{
              step==="review_blueprint"?t("kickoff.stepReview"):
                step==="verify_repository"?t("kickoff.stepRepo"):
                  step==="check_privacy"?t("kickoff.stepPrivacy"):
                    step==="reuse_or_create_board"?t("kickoff.stepBoard"):
                      step==="review_issues"?t("kickoff.stepIssues"):
                        step==="define_ci"?t("kickoff.stepCi"):
                          step==="owner_approval"?t("kickoff.stepApprove"):
                            step==="local_baseline"?t("kickoff.stepLocal"):
                              t("kickoff.stepQueue")
            }</li>)}
          </ol>
        </details>
        <p className="continuity-notice">{t("kickoff.requiresApproval")}</p>
        <button type="button" className="secondary compact-button" onClick={()=>void copy()}>
          <ClipboardCopy size={14}/>{t("kickoff.copyPlan")}
        </button>
        {copied?<small role="status" className="tone-ok">{t("kickoff.copied")}</small>:null}
      </>}
    </div>
  </details>;
}
