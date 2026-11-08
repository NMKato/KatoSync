// Created by NMKato Solutions
// Read-only feature evidence dossier: project-scoped, user-triggered, no model/cloud.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileSearch, GitCommitHorizontal, ShieldAlert } from "lucide-react";
import { useT } from "../i18n";

type FeatureVersion = {
  eventSequence:number; eventKind:string; sectionKey:string;
  heading:string; excerpt:string; baselineSha:string|null;
  baselineMatches:boolean|null; evidenceJson:string; trust:string;
};
type EvidenceCheck = {kind:string; reference:string; check:string};
type SourceCandidate = {sourceRef:string; contentHash:string; truthLevel:string; freshness:string; matchBasis:string};
type FeatureTrace = {
  projectId:string; featureId:string; liveGitHead:string; versions:FeatureVersion[];
  claimedEvidence:EvidenceCheck[]; matchingVerifiedSources:SourceCandidate[];
  completion:string; evidencePolicy:string;
};
export function ContinuityFeatureTrace({ projectId, sectionKey, onClose }: {
  projectId:string; sectionKey:string; onClose:()=>void
}) {
  const {t}=useT();
  const [trace,setTrace]=useState<FeatureTrace|null>(null);
  const [error,setError]=useState(false);
  const [busy,setBusy]=useState(true);
  const version=useRef(0);
  useEffect(()=>{
    const n=++version.current;
    setBusy(true);setTrace(null);setError(false);
    if (!window.__TAURI_INTERNALS__) {setBusy(false);return;}
    void invoke<FeatureTrace>("continuity_feature_trace",{projectId,sectionKey})
      .then(data=>{
        if(n!==version.current)return;
        if(data.projectId!==projectId || data.completion !== "unknown_requires_feature_specific_tests_and_owner_review") {
          setError(true);return;
        }
        setTrace(data);
      }).catch(()=>{if(n===version.current)setError(true);})
      .finally(()=>{if(n===version.current)setBusy(false);});
    return ()=>{version.current+=1;};
  },[projectId,sectionKey]);
  return (
    <section className="continuity-feature-trace" aria-label={t("continuity.trace.title")}>
      <div className="continuity-result-head">
        <div className="agent-card-title"><FileSearch size={16}/><h4>{t("continuity.trace.title")}: {sectionKey}</h4></div>
        <button type="button" className="ghost compact-button" onClick={onClose}>{t("continuity.trace.close")}</button>
      </div>
      {busy?<p role="status">{t("continuity.trace.loading")}</p>:null}
      {error?<p role="alert" className="tone-warn"><ShieldAlert size={14}/>{t("continuity.trace.unavailable")}</p>:null}
      {trace?<>
        <p className="continuity-notice">{t("continuity.trace.statusUnknown")}</p>
        <small>{t("continuity.trace.featureId")}: {trace.featureId} · HEAD {trace.liveGitHead.slice(0,12)}</small>
        <h5>{t("continuity.trace.versions")} ({trace.versions.length})</h5>
        <ol className="continuity-trace-history">{trace.versions.map(x=><li key={x.eventSequence+":"+x.sectionKey}>
          <strong>#{x.eventSequence} · {x.heading}</strong>
          <small>{x.eventKind} · {x.sectionKey}</small>
          <p>{x.excerpt}</p>
          <small className="tone-warn">{t("continuity.trace.unverified")}</small>
        </li>)}</ol>
        <h5>{t("continuity.trace.claims")} ({trace.claimedEvidence.length})</h5>
        {trace.claimedEvidence.length?<ul className="continuity-trace-lines">{trace.claimedEvidence.map((e,i)=>
          <li key={e.reference+":"+i}>
            <GitCommitHorizontal size={13}/>
            <span>{e.kind}: {e.reference}</span>
            <strong>{e.check === "commit_on_current_branch" ? t("continuity.trace.check.commit_on_current_branch")
                : e.check === "commit_not_present_locally" ? t("continuity.trace.check.commit_not_present_locally")
                : e.check === "commit_not_ancestor_of_head" ? t("continuity.trace.check.commit_not_ancestor_of_head")
                : t("continuity.trace.check.unverified_reference")}</strong>
          </li>)}</ul>:<p className="agent-empty">{t("continuity.trace.noClaims")}</p>}
        <h5>{t("continuity.trace.sourceCandidates")} ({trace.matchingVerifiedSources.length})</h5>
        {trace.matchingVerifiedSources.length?<ul className="continuity-trace-lines">{trace.matchingVerifiedSources.map((s,i)=>
          <li key={s.sourceRef+":"+i}>
            <span>{s.sourceRef} · {s.truthLevel} · {s.freshness}</span>
            <strong>{t("continuity.trace.lexical")}</strong>
          </li>)}</ul>:<p className="agent-empty">{t("continuity.trace.noSources")}</p>}
        <p className="continuity-notice">{t("continuity.trace.disclaimer")}</p>
      </>:null}
    </section>
  );
}
