// Created by NMKato Solutions
// Optional GitHub App device login. Backend holds all secrets, UI gets only user code.
import {useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {openUrl} from "@tauri-apps/plugin-opener";
import {CheckCircle2,Copy,ExternalLink,ShieldCheck,Unplug} from "lucide-react";
import {useT} from "../i18n";

type Status = {
 configured:boolean;connected:boolean;login:string|null;expiresAt:number|null;
 permissionsChecked:boolean;writeAccessGranted:false;authSource:string;
};
type Device = {
 sessionId:string;userCode:string;verificationUri:string;expiresIn:number;interval:number;
};
type Poll = {state:string;retryAfterSeconds:number;login:string|null};
export function GithubAppConnectionPanel(){
 const {t}=useT();
 const [status,setStatus]=useState<Status|null>(null);
 const [device,setDevice]=useState<Device|null>(null);
 const [busy,setBusy]=useState(false);
 const [result,setResult]=useState("");
 const [error,setError]=useState(false);
 const latest=useRef(0);
 const mounted=useRef(true);
 useEffect(()=>{
  mounted.current=true;const version=++latest.current;
  void invoke<Status>("github_app_connection_status").then(s=>{
   if(mounted.current&&version===latest.current)setStatus(s);
  }).catch(()=>{
   if(mounted.current&&version===latest.current)setError(true);
  });
  return ()=>{mounted.current=false;latest.current++;};
 },[]);
 async function perform(action:()=>Promise<void>){
  const version=++latest.current;
  setBusy(true);setError(false);setResult("");
  try{await action();}
  catch{if(mounted.current&&version===latest.current)setError(true);}
  finally{if(mounted.current&&version===latest.current)setBusy(false);}
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
 return <details className="kickoff-github-app">
   <summary><ShieldCheck size={15}/>{t("kickoff.authTitle")}</summary>
   <div className="kickoff-github-app-body">
    <small>{t("kickoff.authOptional")}</small>
    {status?.connected?<div className="kickoff-github-app-connected">
     <strong><CheckCircle2 size={15}/>{t("kickoff.authAccount")}: {status.login}</strong>
     <small>{t("kickoff.authNoWrites")}</small>
     <button type="button" className="secondary compact-button" disabled={busy}
      onClick={disconnect}><Unplug size={13}/>{t("kickoff.authDisconnect")}</button>
    </div>:status?.configured===false?<p className="agent-empty">{t("kickoff.authNotConfigured")}</p>
      :!status?<p className="agent-empty">{t("kickoff.authUnavailable")}</p>
      :!device?<button className="secondary compact-button" type="button"
       disabled={busy} onClick={start}>{t("kickoff.authStart")}</button>
      :<div className="kickoff-github-app-device">
        <p>{t("kickoff.authInstructions")}</p>
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
    {error?<p className="tone-warn" role="alert">{t("kickoff.authError")}</p>:null}
    {result?<p role="status" className="agent-empty">{result}</p>:null}
    <small>{t("kickoff.authReadOnly")}</small>
    <small>{t("kickoff.authFuture")}</small>
   </div>
  </details>;
}
