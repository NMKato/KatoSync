// Created by NMKato Solutions
// Explicit read-only provider check. GitHub workflow success != feature acceptance.
import {useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {GitBranch,RefreshCcw,ShieldCheck} from "lucide-react";
import {useT} from "../i18n";

type CiRun = {
  runId:number;workflow:string;attempt:number;status:string;
  conclusion:string|null;source:string;
};
type CiJob = {runId:number;name:string;status:string;conclusion:string|null};
type FeatureGateCheck = {workflow:string;job:string;providerStatus:string;runId:number|null};
type FeatureGate = {
  featureId:string;lane:string;acceptanceCriteria:string;checks:FeatureGateCheck[];
  ciRequirementsSatisfied:boolean;featureAccepted:boolean;coverageStatus:string;
};
type PolicyEntry = {
  featureId:string;status:string;trackedTestSource:string|null;
  readyForCoverageReview:boolean;ownerApproved:boolean;
};
type PolicyAudit = {
  status:string;headSha:string;source:string;checks:PolicyEntry[];
  featureAcceptanceVerified:boolean;
};
type CiReport = {
  projectId:string;repository:string;headSha:string;source:string;
  runs:CiRun[];jobs:CiJob[];featureAcceptanceVerified:boolean;
  ciIdentityVerified:boolean;featureCiCoverage:FeatureGate[];
  acceptancePolicyAudit:PolicyAudit|null;
};
function stateText(status:string,conclusion:string|null):string{
  if(status!=="completed")return status;
  return conclusion??"unknown";
}
export function ProjectGithubCiEvidence({projectId}:{projectId:string}){
  const {t}=useT();
  const [data,setData]=useState<CiReport|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(false);
  const request=useRef(0);
  const projectRef=useRef(projectId);
  projectRef.current=projectId;
  useEffect(()=>{
    request.current+=1;
    setData(null);setBusy(false);setError(false);
    return ()=>{request.current+=1;};
  },[projectId]);
  async function verify(){
    const selected=projectId;
    const version=++request.current;
    setBusy(true);setData(null);setError(false);
    try{
      const info=await invoke<CiReport>("continuity_github_ci",{projectId:selected});
      if(version!==request.current||projectRef.current!==selected)return;
      if(info.projectId!==selected||info.source!=="github_authenticated_readonly" ||
         info.featureAcceptanceVerified!==false||info.ciIdentityVerified!==true ||
         (info.acceptancePolicyAudit && (info.acceptancePolicyAudit.headSha!==info.headSha ||
          info.acceptancePolicyAudit.featureAcceptanceVerified!==false ||
          info.acceptancePolicyAudit.checks.some(entry=>entry.ownerApproved)))){
        setError(true);return;
      }
      setData(info);
    }catch{
      if(version===request.current)setError(true);
    }finally{
      if(version===request.current)setBusy(false);
    }
  }
  return <div className="mvp-ci-evidence">
    <div className="mvp-ci-header">
      <strong><GitBranch size={14}/>{t("mvp.ciHeading")}</strong>
      <button className="secondary compact-button" type="button" disabled={busy||!window.__TAURI_INTERNALS__}
        onClick={()=>void verify()}>
        <RefreshCcw size={13}/>{busy?t("mvp.ciChecking"):t("mvp.ciCheck")}
      </button>
    </div>
    <small>{t("mvp.ciOnDemand")}</small>
    {busy?<p role="status">{t("mvp.ciChecking")}</p>:null}
    {error?<p role="alert" className="tone-warn">{t("mvp.ciUnavailable")}</p>:null}
    {data?<div className="mvp-ci-report">
      <p><ShieldCheck size={14}/><strong>{data.repository}</strong>
        <small> · HEAD {data.headSha.slice(0,12)}</small></p>
      <p className="mvp-verified-notice">{t("mvp.ciProviderOnly")}</p>
      {data.runs.length?<ul className="mvp-ci-runs">
        {data.runs.map(run=><li key={run.runId}>
          <div className="mvp-ci-run-header">
            <strong>{run.workflow}</strong>
            <small>#{run.runId} · {stateText(run.status,run.conclusion)}</small>
          </div>
          {data.jobs.filter(j=>j.runId===run.runId).length?
            <ul className="mvp-ci-jobs">{data.jobs.filter(j=>j.runId===run.runId).map((job,i)=>
              <li key={job.name+":"+i}><span>{job.name}</span><small>{stateText(job.status,job.conclusion)}</small></li>
            )}</ul>:null}
        </li>)}
      </ul>:<p className="agent-empty">{t("mvp.ciNoRuns")}</p>}
      {data.featureCiCoverage.length ? <div className="mvp-ci-feature-list">
        <strong>{t("mvp.featureGates")}</strong>
        <small className="mvp-verified-notice">{t("mvp.policySource")}: {data.acceptancePolicyAudit?.status==="tracked_policy_read"
          ? t("mvp.policyRead") : t("mvp.policyMissing")}</small>
        <p className="mvp-verified-notice">{t("mvp.featureGatesCaveat")}</p>
        {data.featureCiCoverage.map(feature=><details className="mvp-ci-feature-item" key={feature.featureId}>
          <summary>{feature.featureId} · {feature.coverageStatus==="ci_jobs_passed_unapproved"
            ? t("mvp.providerGatesPass") : feature.coverageStatus==="not_configured"
              ? t("mvp.providerGatesMissing") : t("mvp.providerGatesIncomplete")}</summary>
          <small>{feature.acceptanceCriteria}</small>
          {(() => {
            const evidence=data.acceptancePolicyAudit?.checks.find(x=>x.featureId===feature.featureId);
            if (!evidence) return null;
            return <div className="mvp-policy-audit">
              <strong>{evidence.readyForCoverageReview
                ? t("mvp.policyReviewable") : evidence.status==="criteria_mismatch" || evidence.status==="ci_mapping_mismatch"
                  ? t("mvp.policyMismatch") : evidence.status==="test_source_missing"
                    ? t("mvp.policyTestMissing") : t("mvp.policyNotReady")}</strong>
              {evidence.trackedTestSource?<small>{t("mvp.policyTestSource")}: {evidence.trackedTestSource}</small>:null}
              <small>{t("mvp.policyNotApproved")}</small>
            </div>;
          })()}
          {feature.checks.length ? <ul className="mvp-ci-jobs">
            {feature.checks.map(check=><li key={check.workflow+":"+check.job}>
              <span>{check.workflow} / {check.job}</span>
              <small>{check.providerStatus === "provider_pass" ? t("mvp.providerJobPass")
                : check.providerStatus === "missing_workflow" || check.providerStatus==="missing_job"
                  ? t("mvp.providerJobMissing")
                  : check.providerStatus==="workflow_incomplete" || check.providerStatus==="job_incomplete"
                    ? t("mvp.providerJobRunning")
                    : t("mvp.providerJobNotPassed")}</small>
            </li>)}
          </ul> : <small>{t("mvp.providerGatesMissing")}</small>}
        </details>)}
      </div> : null}
      <p className="continuity-notice">{t("mvp.ciNoAcceptance")}</p>
    </div>:null}
  </div>;
}
