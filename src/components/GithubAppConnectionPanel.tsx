// Created by NMKato Solutions
// Optional GitHub App device login. Backend holds all secrets, UI gets only user code.
import {useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {openUrl} from "@tauri-apps/plugin-opener";
import {CheckCircle2,Copy,ExternalLink,Github,Info,RefreshCcw,ShieldCheck,Unplug} from "lucide-react";
import {useT, type TKey} from "../i18n";
import {classifyGithubAuthFailure,type GithubAuthFailure} from "../lib/githubAuthError";
import {ProviderBrandMark} from "./ProviderBrandMark";
import {GithubAppReadOnlyInventory} from "./GithubAppReadOnlyInventory";
import type {GithubIssueHandoff} from "../lib/githubChatHandoff";

type Status = {
 configured:boolean;connected:boolean;login:string|null;expiresAt:number|null;
 permissionsChecked:boolean;writeAccessGranted:false;authSource:string;
};
type Device = {
 sessionId:string;userCode:string;verificationUri:string;expiresIn:number;interval:number;
};
type Poll = {state:string;retryAfterSeconds:number;login:string|null};
export function GithubAppConnectionPanel({variant="nested",refreshEpoch=0,onChatHandoff}:{variant?:"nested"|"provider";refreshEpoch?:number;onChatHandoff?:(handoff:Omit<GithubIssueHandoff,"revision">)=>void}){
 const {t}=useT();
 const [status,setStatus]=useState<Status|null>(null);
 const [device,setDevice]=useState<Device|null>(null);
 const [busy,setBusy]=useState(false);
 const [result,setResult]=useState("");
 const [error,setError]=useState<GithubAuthFailure|null>(null);
 const diagnosis:Record<GithubAuthFailure,TKey>={
  session:"kickoff.authDiagnosisSession",
  keychain:"kickoff.authDiagnosisKeychain",
  network:"kickoff.authDiagnosisNetwork",
  configuration:"kickoff.authDiagnosisConfiguration",
  unknown:"kickoff.authDiagnosisUnknown"
 };
 const latest=useRef(0);
 const mounted=useRef(true);
 useEffect(()=>{
  mounted.current=true;const version=++latest.current;
  void invoke<Status>("github_app_connection_status").then(s=>{
   if(mounted.current&&version===latest.current)setStatus(s);
  }).catch((e:unknown)=>{
   if(mounted.current&&version===latest.current){
     // Never keep displaying a stale "connected" account after verification failed.
     setStatus(null);
     setError(classifyGithubAuthFailure(e));
   }
  });
  return ()=>{mounted.current=false;latest.current++;};
 },[refreshEpoch]);
 // GitHub confirms user consent in the browser, but a device-code approval
 // MUST be polled by the native app to finish token storage. Perform that
 // follow-up automatically only after the user explicitly starts Device Flow.
 // Respect GitHub/native retry intervals; prevent timer leaks and stale responses.
 useEffect(()=>{
  if(!device)return;
  const sessionId=device.sessionId;
  const expiresAt=Date.now()+device.expiresIn*1000;
  let cancelled=false;
  let timer:ReturnType<typeof setTimeout>|null=null;
  const plan=(seconds:number)=>{
   if(cancelled||!mounted.current)return;
   if(Date.now()>=expiresAt){
    setDevice(null);setResult(t("kickoff.authExpired"));return;
   }
   const safeSeconds=Math.min(120,Math.max(5,Math.ceil(seconds)));
   timer=setTimeout(()=>{void step();},safeSeconds*1000);
  };
  const step=async()=>{
   if(cancelled||!mounted.current)return;
   try{
    const reply=await invoke<Poll>("github_app_device_poll",{sessionId});
    if(cancelled||!mounted.current)return;
    if(reply.state==="connected"){
     // The backend has securely saved the token. Re-fetch the read-only
     // status; if Keychain permission fails, expose retry, not false success.
     try{
      const confirmed=await invoke<Status>("github_app_connection_status");
      if(cancelled||!mounted.current)return;
      if(!confirmed.connected)throw new Error("GitHub status not yet verified");
      setStatus(confirmed);setError(null);setResult(t("kickoff.authConnected"));
      // Clear only after status is consumed: changing device triggers effect
      // cleanup, so clearing it before await would suppress this result.
      setDevice(null);
     }catch(e:unknown){
      if(!cancelled&&mounted.current){
       setError(classifyGithubAuthFailure(e));
       setDevice(null); // User can explicitly retry read-only status now.
      }
     }
    }else if(reply.state==="expired"||reply.state==="expired_or_denied"){
     setDevice(null);setResult(t("kickoff.authExpired"));
    }else{
     setResult(t("kickoff.authPending",{count:reply.retryAfterSeconds}));
     plan(reply.retryAfterSeconds);
    }
   }catch(e:unknown){
    if(cancelled||!mounted.current)return;
    setError(classifyGithubAuthFailure(e));
    // If a transient network failure occurs, retry with a bounded interval
    // until the original GitHub device-code expiry, without fresh login.
    plan(12);
   }
  };
  plan(device.interval);
  return ()=>{
   cancelled=true;
   if(timer!==null)clearTimeout(timer);
  };
 },[device]);
 async function perform(action:()=>Promise<void>){
  const version=++latest.current;
  setBusy(true);setError(null);setResult("");
  try{await action();}
  catch(e:unknown){
    if(mounted.current&&version===latest.current)setError(classifyGithubAuthFailure(e));
  }
  finally{if(mounted.current&&version===latest.current)setBusy(false);}
 }
 function refreshStatus(){
  if(busy||device)return; // no concurrent status polling during device-code login
  const version=latest.current+1;
  void perform(async()=>{
   try {
     const actual=await invoke<Status>("github_app_connection_status");
     if(mounted.current&&version===latest.current){
       setStatus(actual);
       setError(null);
     }
   }catch(e){
     if(mounted.current&&version===latest.current)setStatus(null);
     throw e;
   }
  });
 }
 function start(){
  void perform(async()=>{
   const d=await invoke<Device>("github_app_device_begin");
   if(d.verificationUri!=="https://github.com/login/device"||
      !/^[A-Z0-9-]{8,15}$/.test(d.userCode))throw Error("unexpected device code");
   if(mounted.current)setDevice(d);
  });
 }
 function poll(){
  if(!device)return;
  void perform(async()=>{
   const response=await invoke<Poll>("github_app_device_poll",{sessionId:device.sessionId});
   if(!mounted.current)return;
   if(response.state==="connected"){
    setDevice(null);
    const actual=await invoke<Status>("github_app_connection_status");
    if(mounted.current)setStatus(actual);
    setResult(t("kickoff.authConnected"));
   }else if(response.state==="expired"||response.state==="expired_or_denied"){
    setDevice(null);setResult(t("kickoff.authExpired"));
   }else{
    setResult(t("kickoff.authPending",{count:response.retryAfterSeconds}));
   }
  });
 }
 function cancel(){
  void perform(async()=>{
   await invoke("github_app_device_cancel");
   if(mounted.current){setDevice(null);setResult(t("kickoff.authCancelled"));}
  });
 }
 function disconnect(){
  void perform(async()=>{
   const next=await invoke<Status>("github_app_disconnect");
   if(mounted.current){setStatus(next);setDevice(null);setResult(t("kickoff.authDisconnected"));}
  });
 }
 const controls = <>
    {status?.connected?<div className="kickoff-github-app-connected">
      <strong><CheckCircle2 size={15}/>{t("kickoff.authAccount")}: {status.login}</strong>
      {variant==="nested"?<small>{t("kickoff.authNoWrites")}</small>:null}
      <button type="button" className="secondary compact-button" disabled={busy}
        onClick={disconnect}><Unplug size={13}/>{t("kickoff.authDisconnect")}</button>
    </div>:status?.configured===false?<p className="agent-empty">{t("kickoff.authNotConfigured")}</p>
      :!status?<div className="github-provider-status-retry">
        <p className="agent-empty">{t("kickoff.authUnavailable")}</p>
        <button className="secondary compact-button" type="button" disabled={busy}
          onClick={refreshStatus}>{t("kickoff.authRetryStatus")}</button>
      </div>
      :!device?<button className="secondary compact-button github-connect-action" type="button"
       disabled={busy} onClick={start}><Github size={15}/>{t("kickoff.authStart")}</button>
      :<div className="kickoff-github-app-device">
        <p>{t("kickoff.authInstructions")}</p>
        <small>{t("kickoff.authAutoCheck")}</small>
        <strong className="kickoff-github-code">{device.userCode}</strong>
        <div className="kickoff-github-app-actions">
         <button type="button" className="secondary compact-button"
          onClick={()=>void navigator.clipboard.writeText(device.userCode)}>
          <Copy size={13}/>{t("kickoff.authCopy")}</button>
         <button type="button" className="secondary compact-button"
          onClick={()=>void openUrl("https://github.com/login/device")}>
          <ExternalLink size={13}/>{t("kickoff.authOpenGithub")}</button>
         <button type="button" className="secondary compact-button" disabled={busy}
          onClick={poll}>{t("kickoff.authCheck")}</button>
         <button type="button" className="ghost compact-button" disabled={busy}
          onClick={cancel}>{t("kickoff.authCancel")}</button>
        </div>
        <small>{t("kickoff.authExpires",{count:Math.ceil(device.expiresIn/60)})}</small>
       </div>}
    {variant==="provider"&&status!==null&&status.configured!==false?<button type="button"
      className="ghost compact-button github-status-refresh" disabled={busy||Boolean(device)}
      onClick={refreshStatus}>
      <RefreshCcw size={14} className={busy?"spin":""}/>{t("connections.refreshGithub")}
    </button>:null}
    {error?<p className="tone-warn" role="alert">
      {t("kickoff.authError")} {t(diagnosis[error])}
    </p>:null}
    {result?<p role="status" className="agent-empty">{result}</p>:null}
  </>;
 if(variant==="provider"){
  return <article className="github-provider-card" aria-label={t("github.integration.section")} aria-busy={busy}>
   <header className="github-provider-card-head">
    <ProviderBrandMark provider="github" size="card" />
    <div className="github-provider-card-title">
     <h3>GitHub App</h3>
     <p>{t("github.integration.shortDescription")}</p>
    </div>
    <span className="github-provider-card-status">
     {status?.connected?<><CheckCircle2 size={14}/>{t("github.integration.connectedLabel")}</>:t("github.integration.optionalLabel")}
    </span>
   </header>
   <div className="github-provider-card-controls">{controls}</div>
   {status?.connected?<GithubAppReadOnlyInventory key={(status.login ?? "github-user")+":"+refreshEpoch} onChatHandoff={onChatHandoff} />:null}
   <details className="github-provider-card-info">
    <summary><Info size={15}/>{t("github.integration.infoLabel")}</summary>
    <div className="github-provider-card-info-body">
     <p>{t("github.integration.existingSession")}</p>
     <p>{t("github.integration.consentHint")}</p>
     <p>{t("kickoff.authNoWrites")}</p>
     <p>{t("kickoff.authFuture")}</p>
    </div>
   </details>
  </article>;
 }
 return <details className="kickoff-github-app">
   <summary><ShieldCheck size={15}/>{t("kickoff.authTitle")}</summary>
   <div className="kickoff-github-app-body">
    <small>{t("kickoff.authOptional")}</small>
    {controls}
    <small>{t("kickoff.authReadOnly")}</small>
    <small>{t("kickoff.authFuture")}</small>
   </div>
  </details>;
}
