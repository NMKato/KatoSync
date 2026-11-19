// Created by NMKato Solutions. Synthetic UI fixture; never a live device or permission proof.
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider} from "../../src/i18n";
import {AccountMeshContext} from "../../src/contexts/AccountMeshContext";
import {AccountDevicesCard,AccountDeviceNotifications} from "../../src/components/AccountDevicesCard";
import "../../src/styles.css";
const own="20000000-0000-4000-8000-000000000001",peer="20000000-0000-4000-8000-000000000002",owner="10000000-0000-4000-8000-000000000001";
const fp=(b)=>Array(16).fill(b).join("-");
const scene=new URL(location.href).searchParams.get("scene")||"ready";
const lang=new URL(location.href).searchParams.get("lang")||"de";
localStorage.setItem("katosync.lang",lang);
const base={ownerId:owner,localDeviceId:own,localFingerprint:fp("11"),localPublicKey:"a".repeat(43),mainDeviceId:peer,mainDeviceAvailable:true,accountRevision:1,accountVerified:true,devices:[
{deviceId:own,ownerUserId:owner,displayName:"MacBook Air",personaName:null,platformOs:"macos",membershipState:"discovered",fingerprint:fp("11"),publicKey:"a".repeat(43),lastSeenAt:new Date().toISOString()},
{deviceId:peer,ownerUserId:owner,displayName:"Studio Mac",personaName:null,platformOs:"macos",membershipState:"discovered",fingerprint:fp("22"),publicKey:"b".repeat(43),lastSeenAt:new Date(Date.now()-180000).toISOString()},
{deviceId:"20000000-0000-4000-8000-000000000003",ownerUserId:owner,displayName:"Notebook Windows",personaName:null,platformOs:"windows",membershipState:"discovered",fingerprint:fp("33"),publicKey:"c".repeat(43),lastSeenAt:new Date(Date.now()-500000).toISOString()}]};
if(scene==="empty")base.devices=[base.devices[0]];
if(scene==="setup"||scene==="empty"){base.mainDeviceId=null;base.mainDeviceAvailable=false;base.accountRevision=0;}
if(scene==="add"){base.localDeviceId=null;base.localFingerprint=null;base.localPublicKey=null;base.devices.shift();}
const proof={version:1,reviewId:"visual-review",peerDeviceId:peer,peerFingerprint:fp("22"),expectedRevision:1,expiresAt:Date.now()+180000,proofReady:true};
window.__meshActions=[];
const idle={phase:"idle",session:null,proof:null,issue:null};
function Example(){
const [network,setNetwork]=useState(base),[approved,setApproved]=useState(scene==="connected"||scene==="offline"||scene==="approved"?[fp("22")]:[]);
const [review,setReview]=useState(scene==="review"?proof:null),[reviewOpen,setReviewOpen]=useState(scene==="review"),[pairing,setPairing]=useState(idle);
const [runtime,setRuntime]=useState({ownerId:owner,localDeviceId:own,mainDeviceId:base.mainDeviceId,accountRevision:base.accountRevision,serverState:"idle",errorCode:null,remoteJobsEnabled:false,profiles:scene==="approved"?[{peerDeviceId:peer,peerFingerprint:fp("22"),mode:"ask",enabled:false}]:[],connections:scene==="connected"||scene==="offline"?[{peerDeviceId:peer,peerFingerprint:fp("22"),role:"client",state:scene,lastHeartbeatAt:Date.now(),expiresAt:Date.now()+180000,errorCode:null,remoteJobsEnabled:false}]:[]});
const act=(name,args)=>window.__meshActions.push({name,args});
const model={network,runtime,approved,loading:false,busy:false,issue:null,pairing,review,reviewOpen,now:Date.now(),
refresh:async()=>{act("refresh",{});setRuntime({...runtime,profiles:runtime.profiles.map(p=>({...p}))});},addThisDevice:async()=>act("add",{}),
setPrimary:async(deviceId,expectedRevision)=>{act("primary",{deviceId,expectedRevision});setNetwork({...network,mainDeviceId:deviceId,mainDeviceAvailable:true,accountRevision:expectedRevision+1});return true;},
connect:async(peerId,mode)=>{act("connect",{peerId,mode});setReview(proof);setReviewOpen(true);},
stop:async(peerId)=>{act("stop",{peerId});setRuntime({...runtime,connections:[]});},
setMode:async(peerId,mode)=>{act("mode",{peerId,mode});return true;},revoke:async(peerId)=>{act("revoke",{peerId});setApproved([]);return true;},
approve:async(mode)=>{act("approve",{mode});setApproved([fp("22")]);setReviewOpen(false);setReview(null);setRuntime({...runtime,connections:[{peerDeviceId:peer,peerFingerprint:fp("22"),role:"client",state:"connected",lastHeartbeatAt:Date.now(),expiresAt:Date.now()+180000,errorCode:null,remoteJobsEnabled:false}]});},
openReview:()=>setReviewOpen(true),closeReview:()=>setReviewOpen(false),cancelPairing:()=>setPairing(idle)};
return <I18nProvider><AccountMeshContext.Provider value={model}><main style={{maxWidth:940,margin:"36px auto",padding:"0 18px"}}><p style={{fontSize:11,color:"var(--text-muted)",letterSpacing:1,marginBottom:18}}>KATOSYNC · UI-PRÜFUNG MIT BEISPIELDATEN</p><AccountDevicesCard/><AccountDeviceNotifications devicesVisible onOpenDevices={()=>act("view",{})}/></main></AccountMeshContext.Provider></I18nProvider>;
}
createRoot(document.getElementById("root")).render(<Example/>);
