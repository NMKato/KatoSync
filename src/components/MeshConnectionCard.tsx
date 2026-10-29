// Created by NMKato Solutions
// KatoSync connections: isolated Mesh QA controller.
// UI is independent of Vision graph. Peer trust and remote jobs remain fail-closed.
import { ShieldCheck, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT, type TKey } from "../i18n";
import { classifyMeshIdentityFailure, type MeshIdentityFailure } from "../lib/meshIdentityDiagnosis";

function relativeTime(value: string | null | undefined, lang: string): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  const seconds = Math.round((at - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86_400), "day");
}

type MeshLocalReadiness = {
  protocol: string;
  platform: string;
  architecture: string;
  localControl: "fresh" | "stale" | "unknown";
  deviceIdentity: "not_paired";
  peerTransport: "not_connected";
  verifiedPeers: number;
  remoteReadOnlyDispatch: boolean;
  crossDeviceWrites: boolean;
};

type MeshHubPreference = {
  preferred: boolean;
  hubActive: false;
  transportReady: false;
  remoteJobsEnabled: false;
  status: "preference_only";
};

type MeshAccountDevice = {
  deviceId:string;
  ownerUserId:string;
  displayName:string;
  personaName:string|null;
  platformOs:"macos"|"windows"|"linux";
  membershipState:"discovered"|"pending"|"trusted"|"revoked";
  fingerprint:string;
  lastSeenAt:string|null;
};
type MeshAccountDirectory = {
  devices:MeshAccountDevice[];
  accountVerified:true;
  discoveryOnly:true;
  transportReady:false;
  remoteJobsEnabled:false;
};

type MeshIdentityStatus = {
  fingerprint: string;
  algorithm: string;
  paired: false;
  peerCount: 0;
  transportReady: false;
};
type MeshSignedOffer = {
  protocol: string;
  publicKey: string;
  nonce: string;
  expiresAt: number;
  accountScope: string;
  signature: string;
};
type NativeInboxInvite = {
  protocol:"katosync-mesh-inbox-send-v1";
  sourceDeviceId:string;
  targetDeviceId:string;
  signedOffer:MeshSignedOffer;
  dispatchSignature:string;
};
// Public signatures only. Stage 2M deliberately does not send anything.
type MeshPairingProof = {
  fingerprint: string;
  comparisonCode: string;
  paired: false;
  peerCount: 0;
  transportReady: false;
};
type MeshApprovedPeer = {
  fingerprint: string;
  publicKey: string;
  approvedAt: number;
  status: "locally_approved";
};
type MeshPeerInventory = {
  approvalOnly: true;
  transportReady: false;
  remoteJobsEnabled: false;
  peers: MeshApprovedPeer[];
};

// No peer registration or network request: only a Tauri read of local daemon
// state. RDC connectivity is intentionally NOT counted as trusted Mesh peers.
export function MeshConnectionCard({refreshEpoch=0}:{refreshEpoch?:number}) {
  const {t,lang}=useT();
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [hubPreference,setHubPreference]=useState<MeshHubPreference|null>(null);
  const [hubBusy,setHubBusy]=useState(false);
  const [hubError,setHubError]=useState(false);
  useEffect(()=>{
    let active=true;
    invoke<MeshHubPreference>("mesh_hub_preference_get")
      .then(preference=>{if(active){setHubPreference(preference);setHubError(false);}})
      .catch(()=>{if(active)setHubError(true);});
    return ()=>{active=false;};
  },[refreshEpoch]);
  const setHubPreferred=async(preferred:boolean)=>{
    setHubBusy(true);
    setHubError(false);
    try {
      const confirmed=await invoke<MeshHubPreference>("mesh_hub_preference_set",{preferred});
      if(confirmed.hubActive || confirmed.transportReady || confirmed.remoteJobsEnabled ||
          confirmed.status!=="preference_only" || confirmed.preferred!==preferred){
        setHubError(true);
      }else{
        setHubPreference(confirmed);
      }
    }catch{
      setHubError(true);
    }finally{
      setHubBusy(false);
    }
  };

  const [reauthOpen,setReauthOpen]=useState(false);
  const [snapshot,setSnapshot]=useState<MeshLocalReadiness|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(false);
  const [identity,setIdentity]=useState<MeshIdentityStatus|null>(null);
  const [offer,setOffer]=useState("");
  const [incoming,setIncoming]=useState("");
  const [inspected,setInspected]=useState<MeshIdentityStatus|null>(null);
  const [identityError,setIdentityError]=useState(false);
  const [identityFailure,setIdentityFailure]=useState<MeshIdentityFailure|null>(null);
  const [pairingBusy,setPairingBusy]=useState(false);
  const [challengeIncoming,setChallengeIncoming]=useState("");
  const [challengeOutgoing,setChallengeOutgoing]=useState("");
  const [responseIncoming,setResponseIncoming]=useState("");
  const [responseOutgoing,setResponseOutgoing]=useState("");
  const [pairingProof,setPairingProof]=useState<MeshPairingProof|null>(null);
  const [pairingVerified,setPairingVerified]=useState<MeshPairingProof|null>(null);
  const [confirmedCode,setConfirmedCode]=useState("");
  const [approvedPeers,setApprovedPeers]=useState<MeshApprovedPeer[]|null>(null);
  const [approvalError,setApprovalError]=useState(false);
  const [reauthEmail,setReauthEmail]=useState("");
  const [reauthPassword,setReauthPassword]=useState("");
  const [reauthBusy,setReauthBusy]=useState(false);
  const [reauthResult,setReauthResult]=useState<"success"|"failed"|null>(null);
  useEffect(()=>{
    if(import.meta.env.VITE_KATOOS_AUTH_QA!=="1")return;
    let alive=true;
    void invoke<{loggedIn:boolean;email:string|null}>("supabase_session_status")
      .then(status=>{if(alive&&status.email)setReauthEmail(status.email);})
      .catch(()=>{});
    return ()=>{alive=false;};
  },[]);
  const renewSession=async()=>{
    if(!reauthEmail.trim()||!reauthPassword||reauthBusy)return;
    setReauthBusy(true);setReauthResult(null);
    try{
      const result=await invoke<{loggedIn:boolean;email:string|null}>(
        "renew_katoos_qa_session",{email:reauthEmail.trim(),password:reauthPassword}
      );
      if(result.loggedIn!==true)throw new Error("issuer_rejected");
      setIdentityFailure(null);
      setIdentityError(false);
      // Only prepare local identity after the verified reauthentication.
      const actual=await invoke<MeshIdentityStatus>("mesh_device_identity_prepare");
      if(actual.paired||actual.peerCount||actual.transportReady)throw new Error("unexpected_trust_claim");
      setIdentity(actual);
      // Success is a durable claim ONLY if a fresh issuer lookup and native
      // device identity check both succeeded. Never show stale green success.
      setReauthResult("success");
    }catch{
      setIdentity(null);
      setOffer("");
      setReauthResult("failed");
    }finally{
      setReauthPassword("");
      setReauthBusy(false);
    }
  };
  const [directory,setDirectory]=useState<MeshAccountDirectory|null>(null);
  const [nativeInboxBusy,setNativeInboxBusy]=useState(false);
  const [nativeInboxError,setNativeInboxError]=useState(false);
  const [nativeInboxPrepared,setNativeInboxPrepared]=useState<string|null>(null);
  const [directoryBusy,setDirectoryBusy]=useState(false);
  const [directoryError,setDirectoryError]=useState(false);
  const prepareNativeInbox=async(targetDeviceId:string)=>{
    if(nativeInboxBusy||!directory?.devices.some(d=>d.deviceId===targetDeviceId&&d.membershipState==="discovered"))return;
    setNativeInboxBusy(true);setNativeInboxError(false);setNativeInboxPrepared(null);
    try {
      const result=await invoke<NativeInboxInvite>("mesh_inbox_invite_prepare",{targetDeviceId});
      if(result.protocol!=="katosync-mesh-inbox-send-v1"||
         result.targetDeviceId!==targetDeviceId||
         !result.sourceDeviceId||result.sourceDeviceId===targetDeviceId||
         result.signedOffer?.protocol!=="katosync-mesh-pairing-v1"||
         !/^[A-Za-z0-9_-]{86}$/.test(result.dispatchSignature)||
         result.signedOffer.expiresAt*1000<=Date.now()){
        throw new Error("invalid_native_inbox_receipt");
      }
      // No Edge call, no auto-trust, no remote job. Only a native public signed draft.
      setNativeInboxPrepared(targetDeviceId);
    }catch{setNativeInboxError(true);}
    finally{setNativeInboxBusy(false);}
  };
  const loadAccountDirectory=async()=>{
    setDirectoryBusy(true);setDirectoryError(false);setDirectory(null);
    setNativeInboxPrepared(null);setNativeInboxError(false);
    try{
      const roster=await invoke<MeshAccountDirectory>("mesh_account_device_discover");
      if(roster.accountVerified!==true || roster.discoveryOnly!==true ||
         roster.transportReady!==false || roster.remoteJobsEnabled!==false ||
         !Array.isArray(roster.devices) || roster.devices.length>10 ||
         roster.devices.some(d=>!d.deviceId||!d.displayName||!d.fingerprint||
           !["macos","windows","linux"].includes(d.platformOs)||
           !["discovered","pending","trusted","revoked"].includes(d.membershipState)))
        throw new Error("invalid_directory_contract");
      setDirectory(roster);
    }catch{setDirectoryError(true);}
    finally{setDirectoryBusy(false);}
  };
  const [clipboardStatus,setClipboardStatus]=useState<"ok"|"failed"|null>(null);
  const copyPublicMessage=async(payload:string)=>{
    // Es werden nur signierte, oeffentliche Pairing-Nachrichten kopiert.
    // Niemals Konto-Tokens, Keychain-Seeds oder unverifizierte Geraete-Freigaben.
    setClipboardStatus(null);
    try{
      if(!navigator.clipboard?.writeText)throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(payload);
      setClipboardStatus("ok");
    }catch{setClipboardStatus("failed");}
  };
  const prepareAndInvite=async()=>{
    setPairingBusy(true);setIdentityError(false);setIdentityFailure(null);
    setOffer("");setClipboardStatus(null);
    try{
      const actual=await invoke<MeshIdentityStatus>("mesh_device_identity_prepare");
      if(actual.paired||actual.peerCount||actual.transportReady)throw new Error("unexpected_trust_claim");
      setIdentity(actual);
      const invite=await invoke<MeshSignedOffer>("mesh_pairing_offer_create");
      if(invite.protocol!=="katosync-mesh-pairing-v1"||!invite.signature||!invite.publicKey)
        throw new Error("invalid_public_invite");
      setOffer(JSON.stringify(invite));
    }catch(error:unknown){
      setIdentityError(true);
      const failure=classifyMeshIdentityFailure(error);
      setIdentityFailure(failure);
      if(["account","session","refresh","changed","invalid","network"].includes(failure)){
        setReauthResult(null);
        setIdentity(null);
        setOffer("");
      }
    }finally{setPairingBusy(false);}
  };
  const checkAndPrepareReply=async()=>{
    if(!incoming.trim())return;
    setPairingBusy(true);setIdentityError(false);setIdentityFailure(null);
    setChallengeOutgoing("");setInspected(null);setClipboardStatus(null);
    try{
      const checked=await invoke<MeshIdentityStatus>("mesh_pairing_offer_inspect",{offerJson:incoming});
      if(checked.paired||checked.peerCount||checked.transportReady)
        throw new Error("unexpected_trust_claim");
      setInspected(checked);
      // Herausforderung ist nur ein signierter Besitznachweis, KEINE Peer-Freigabe.
      const challenge=await invoke<string>("mesh_pairing_challenge_create",{offerJson:incoming});
      if(JSON.parse(challenge)?.protocol!=="katosync-mesh-challenge-v1")
        throw new Error("invalid_challenge");
      setChallengeOutgoing(challenge);
    }catch{setIdentityError(true);}
    finally{setPairingBusy(false);}
  };
  const checkInventory=(value:MeshPeerInventory)=>{
    if(!value.approvalOnly||value.transportReady||value.remoteJobsEnabled||
      !Array.isArray(value.peers)||value.peers.length>10||
      value.peers.some(p=>p.status!=="locally_approved")) {
      throw new Error("unexpected_peer_permission");
    }
    setApprovedPeers(value.peers);
  };
  const loadApproved=async()=>{
    setPairingBusy(true);setApprovalError(false);
    try {checkInventory(await invoke<MeshPeerInventory>("mesh_local_approved_peers"));}
    catch{setApprovedPeers(null);setApprovalError(true);}
    finally{setPairingBusy(false);}
  };
  const approvePeer=async()=>{
    setPairingBusy(true);setApprovalError(false);
    try{
      checkInventory(await invoke<MeshPeerInventory>("mesh_local_approve_peer",
        {confirmedCode:confirmedCode.toUpperCase().trim()}));
      setConfirmedCode("");
      setPairingProof(null);setPairingVerified(null);
    }catch{setApprovalError(true);}
    finally{setPairingBusy(false);}
  };
  const revokePeer=async(fingerprint:string)=>{
    setPairingBusy(true);setApprovalError(false);
    try{checkInventory(await invoke<MeshPeerInventory>("mesh_local_revoke_peer",{fingerprint}));}
    catch{setApprovalError(true);}
    finally{setPairingBusy(false);}
  };
  const checkProof=(value:MeshPairingProof)=>{
    if(value.paired||value.peerCount!==0||value.transportReady||
      !/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(value.comparisonCode)) {
      throw new Error("invalid_pairing_proof");
    }
  };
  const createChallenge=async()=>{
    setPairingBusy(true);setIdentityError(false);setChallengeOutgoing("");setPairingVerified(null);
    try {
      const raw=await invoke<string>("mesh_pairing_challenge_create",{offerJson:incoming});
      if(JSON.parse(raw)?.protocol!=="katosync-mesh-challenge-v1")throw new Error("invalid_challenge");
      setChallengeOutgoing(raw);
    }catch{setIdentityError(true);}finally{setPairingBusy(false);}
  };
  const createResponse=async()=>{
    setPairingBusy(true);setIdentityError(false);setResponseOutgoing("");setPairingProof(null);
    try {
      const [raw,value]=await invoke<[string,MeshPairingProof]>("mesh_pairing_response_create",
        {challengeJson:challengeIncoming});
      if(JSON.parse(raw)?.protocol!=="katosync-mesh-response-v1")throw new Error("invalid_response");
      checkProof(value);setResponseOutgoing(raw);setPairingProof(value);
    }catch{setIdentityError(true);}finally{setPairingBusy(false);}
  };
  const verifyResponse=async()=>{
    setPairingBusy(true);setIdentityError(false);setPairingVerified(null);
    try{
      const result=await invoke<MeshPairingProof>("mesh_pairing_response_verify",
        {responseJson:responseIncoming});
      checkProof(result);setPairingVerified(result);
    }catch{setIdentityError(true);}finally{setPairingBusy(false);}
  };
  const prepareIdentity=async()=>{
    setPairingBusy(true);setIdentityError(false);setIdentityFailure(null);
    try {
      const actual=await invoke<MeshIdentityStatus>("mesh_device_identity_prepare");
      if(actual.paired||actual.peerCount||actual.transportReady)throw new Error("unexpected_trust_claim");
      setIdentity(actual);
    } catch(e:unknown) {
      setIdentityError(true);
      setIdentityFailure(classifyMeshIdentityFailure(e));
    }
    finally {setPairingBusy(false);}
  };
  const createOffer=async()=>{
    setPairingBusy(true);setIdentityError(false);setOffer("");
    try{
      const invite=await invoke<MeshSignedOffer>("mesh_pairing_offer_create");
      if(invite.protocol!=="katosync-mesh-pairing-v1")throw new Error("bad_version");
      setOffer(JSON.stringify(invite));
    }catch{setIdentityError(true);}finally{setPairingBusy(false);}
  };
  const inspectOffer=async()=>{
    setPairingBusy(true);setIdentityError(false);setInspected(null);
    try{
      const actual=await invoke<MeshIdentityStatus>("mesh_pairing_offer_inspect",{offerJson:incoming});
      if(actual.paired||actual.peerCount||actual.transportReady)throw new Error("unexpected_trust_claim");
      setInspected(actual);
    }catch{setIdentityError(true);}finally{setPairingBusy(false);}
  };
  const refresh=useCallback(async()=>{
    setLoading(true);
    try {
      if(!window.__TAURI_INTERNALS__) {
        setSnapshot(null);
        setError(false);
        return;
      }
      const actual=await invoke<MeshLocalReadiness>("mesh_local_readiness");
      if(actual.protocol!=="mesh-readonly-v0" || actual.deviceIdentity!=="not_paired" ||
        actual.peerTransport!=="not_connected" || actual.verifiedPeers!==0 ||
        actual.remoteReadOnlyDispatch || actual.crossDeviceWrites) {
        throw new Error("unexpected_mesh_security_contract");
      }
      setSnapshot(actual);
      setError(false);
    } catch {
      setSnapshot(null);
      setError(true);
    } finally {setLoading(false);}
  },[]);
  useEffect(()=>{
    // A status refresh is deliberately read-only: do NOT invoke
    // mesh_account_device_discover (which registers the local device).
    // Old discovered roster rows must not look freshly verified.
    setDirectory(null);
    setDirectoryError(false);
    void refresh();
  },[refresh,refreshEpoch]);
  const authRejected=identityError&&
    ["account","session","refresh","invalid","changed"].includes(identityFailure??"");
  const revealReauth=()=>{
    setDetailsOpen(true);
    setReauthOpen(true);
  };
  const readiness=snapshot?.localControl??"unknown";
  return <section className="vision-mesh-readiness vision-mesh-compact provider-mesh-card glass" aria-label={t("mesh.simple.title")}>
    <div className="vision-mesh-compact-top">
      <div className="vision-mesh-compact-identity">
        <span className="vision-mesh-compact-icon"><ShieldCheck size={19} aria-hidden="true"/></span>
        <div className="vision-mesh-compact-status">
          <strong>{t("mesh.simple.title")}</strong>
          <span className="vision-mesh-compact-state"><span className="vision-mesh-offline-dot"/>
            {error?t("mesh.simple.unavailable"):t("mesh.simple.disconnected")}
          </span>
          <small>{t("mesh.simple.noPeers")}</small>
        </div>
        <button type="button" className="ghost compact-button mesh-status-refresh"
          aria-label={t("connections.refreshMesh")} title={t("connections.refreshMesh")}
          onClick={()=>void refresh()} disabled={loading||pairingBusy||directoryBusy}>
          <RefreshCcw size={16} className={loading?"spin":""}/>
        </button>
      </div>
      <div className="vision-mesh-compact-actions">
        <button type="button" className="ghost compact-button" disabled={directoryBusy||!snapshot}
          onClick={()=>void loadAccountDirectory()}>
          <RefreshCcw size={15} className={directoryBusy?"spin":""}/>
          {t("mesh.directory.refresh")}
        </button>
        <button type="button" className="primary compact-button"
          disabled={pairingBusy||!snapshot}
          onClick={()=>void prepareAndInvite()}>{t("mesh.simple.connect")}</button>
        <button type="button" className="ghost compact-button" aria-expanded={detailsOpen}
          aria-controls="vision-mesh-technical-details"
          onClick={()=>setDetailsOpen(value=>!value)}>{t("mesh.simple.details")}</button>
      </div>
    </div>
    {offer?<div className="vision-mesh-compact-notice" role="status">
      <span>{t("mesh.simple.offerReady")}</span>
      <button type="button" className="ghost compact-button"
        onClick={()=>void copyPublicMessage(offer)}>{t("mesh.quick.copyPublicInvite")}</button>
    </div>:null}
    {directoryError?<p className="vision-mesh-compact-notice" role="status">
      {t("mesh.simple.discoveryNotReady")}</p>:null}
    {directory?.devices.length===0?<p className="vision-mesh-compact-notice" role="status">
      {t("mesh.directory.empty")}</p>:null}
    {identityError?<p role="alert" className="vision-mesh-compact-notice vision-mesh-error">
      {t("mesh.v1.failed")}
      {identityFailure?" "+t(("mesh.identity.diag."+identityFailure) as TKey):null}
      {authRejected&&import.meta.env.VITE_KATOOS_AUTH_QA==="1"?
        <button type="button" className="ghost compact-button"
          onClick={revealReauth}>{t("mesh.simple.renewAction")}</button>:null}
    </p>:null}
    {clipboardStatus?<p className="vision-mesh-compact-notice" role="status">
      {t(clipboardStatus==="ok"?"mesh.quick.copied":"mesh.quick.copyFailed")}
    </p>:null}
    <div className="vision-mesh-technical" id="vision-mesh-technical-details" hidden={!detailsOpen}>
      <section className="mesh-hub-preference" aria-label={t("mesh.hub.heading")}>
        <label className="mesh-hub-preference-option">
          <input type="checkbox" checked={hubPreference?.preferred??false}
            disabled={!hubPreference||hubBusy}
            onChange={e=>void setHubPreferred(e.target.checked)}/>
          <span>
            <strong>{t("mesh.hub.prefer")}</strong>
            <small>{t("mesh.hub.description")}</small>
          </span>
        </label>
        <p className="mesh-hub-preference-note" role="status">{t("mesh.hub.notActive")}</p>
        {hubError?<p className="vision-mesh-error" role="alert">{t("mesh.hub.error")}</p>:null}
      </section>
      <div className="vision-mesh-technical-status">
        <strong>{t("mesh.simple.diagnostics")}</strong>
        <span>{t("mesh.v0.title")} · {snapshot?(snapshot.platform+" · "+snapshot.architecture):t("mesh.v0.localUnknown")}</span>
        <span>{t("mesh.v0.control")}: {t(("mesh.v0."+readiness) as TKey)}</span>
        <span>{t("mesh.v0.notPaired")} · {t("mesh.v0.noDispatch")}</span>
        <span>{t("mesh.simple.qualityUnknown")} · {t("mesh.simple.uptimeUnknown")}</span>
        <small>{error?t("mesh.v0.unavailable"):t("mesh.v0.trustBoundary")}</small>
        <button type="button" className="ghost compact-button"
          onClick={()=>void refresh()} disabled={loading}>
          <RefreshCcw size={14} className={loading?"spin":""}/>{t("mesh.v0.check")}
        </button>
      </div>
    {import.meta.env.VITE_KATOOS_AUTH_QA==="1"?<details className="vision-mesh-reauth"
      open={reauthOpen} onToggle={e=>setReauthOpen(e.currentTarget.open)}>
      <summary>{t("mesh.reauth.title")}</summary>
      <p>{t("mesh.reauth.description")}</p>
      <form onSubmit={e=>{e.preventDefault();void renewSession();}}>
        <label className="vision-mesh-field">{t("mesh.reauth.email")}
          <input type="email" autoComplete="username" value={reauthEmail} required
            onChange={e=>setReauthEmail(e.target.value)}/>
        </label>
        <label className="vision-mesh-field">{t("mesh.reauth.password")}
          <input type="password" autoComplete="current-password" value={reauthPassword} required
            onChange={e=>setReauthPassword(e.target.value)}/>
        </label>
        <button type="submit" className="secondary" disabled={!reauthEmail.trim()||!reauthPassword||reauthBusy}>
          {t(reauthBusy?"mesh.reauth.working":"mesh.reauth.submit")}
        </button>
      </form>
      {reauthResult?<p role="status">{t(reauthResult==="success"?"mesh.reauth.success":"mesh.reauth.failed")}</p>:null}
    </details>:null}
    <section className="vision-mesh-account-directory" aria-label={t("mesh.directory.heading")}>
      <div className="vision-mesh-directory-heading">
        <strong>{t("mesh.directory.heading")}</strong>
        <span className="vision-mesh-directory-note">{t("mesh.simple.discoveryStatus")}</span>
      </div>
      <p>{t("mesh.directory.notice")}</p>
      {directory?.devices.length===0?<p role="status">{t("mesh.directory.empty")}</p>:null}
      {directory?.devices.map(device=><div className="vision-mesh-directory-row" key={device.deviceId}>
        <div><strong>{device.personaName||device.displayName}</strong>
          {device.personaName?<small>{device.displayName}</small>:null}
          <small>{device.platformOs} · {t(("mesh.directory."+device.membershipState) as TKey)}</small>
        </div>
        <small>{device.lastSeenAt?
          t("mesh.directory.lastSeen",{time:relativeTime(device.lastSeenAt,lang)||"—"}):
          t("mesh.directory.notSeen")}</small>
        {import.meta.env.VITE_KATOOS_AUTH_QA==="1"&&device.membershipState==="discovered"?
          <button type="button" className="ghost compact-button"
            disabled={nativeInboxBusy||pairingBusy||directoryBusy}
            onClick={()=>void prepareNativeInbox(device.deviceId)}>
            {t("mesh.inbox.prepare")}
          </button>:null}
      </div>)}
      {nativeInboxPrepared?<p role="status" className="vision-mesh-compact-notice">
        {t("mesh.inbox.prepared")} {t("mesh.inbox.notSent")}
      </p>:null}
      {nativeInboxError?<p role="alert" className="vision-mesh-error">
        {t("mesh.inbox.failed")}
      </p>:null}
      {directoryError?<p role="alert">{t("mesh.directory.unavailable")}</p>:null}
    </section>
    <details className="vision-mesh-pairing">
      <summary>{t("mesh.v1.heading")}</summary>
      <p>{t("mesh.quick.description")}</p>
      <div className="vision-mesh-quick-panel" aria-label={t("mesh.quick.heading")}>
        <strong>{t("mesh.quick.heading")}</strong>
        <p>{t("mesh.quick.accountSafety")}</p>

        {offer?<div className="vision-mesh-quick-result">
          <p role="status">{t("mesh.quick.publicInviteReady")}</p>
          <button type="button" className="ghost compact-button"
            onClick={()=>void copyPublicMessage(offer)}>{t("mesh.quick.copyPublicInvite")}</button>
          <small>{t("mesh.quick.transferNotice")}</small>
        </div>:null}
        <label className="vision-mesh-field">{t("mesh.quick.receivedInvite")}
          <textarea value={incoming} maxLength={2048} rows={2}
            onChange={e=>setIncoming(e.target.value)} placeholder={t("mesh.v1.paste")}/>
        </label>
        <button type="button" className="ghost compact-button"
          disabled={pairingBusy||!incoming.trim()||!snapshot}
          onClick={()=>void checkAndPrepareReply()}>{t("mesh.quick.checkInvite")}</button>
        {challengeOutgoing?<div className="vision-mesh-quick-result">
          <p role="status">{t("mesh.quick.replyReady")}</p>
          <button type="button" className="ghost compact-button"
            onClick={()=>void copyPublicMessage(challengeOutgoing)}>{t("mesh.quick.copyPublicReply")}</button>
          <small>{t("mesh.quick.notPaired")}</small>
        </div>:null}
        {clipboardStatus?<p role="status">{t(clipboardStatus==="ok"?"mesh.quick.copied":"mesh.quick.copyFailed")}</p>:null}
        <p className="vision-mesh-warning">{t("mesh.quick.discoveryPending")}</p>
      </div>
      <details className="vision-mesh-advanced">
      <summary>{t("mesh.quick.technicalOptions")}</summary>
      <p>{t("mesh.v1.description")}</p>
      <div className="vision-mesh-actions">
        <button type="button" className="ghost compact-button" onClick={()=>void prepareIdentity()}
          disabled={pairingBusy||!snapshot}>{t("mesh.v1.prepare")}</button>
        <button type="button" className="ghost compact-button" onClick={()=>void createOffer()}
          disabled={pairingBusy||!identity}>{t("mesh.v1.invite")}</button>
      </div>
      {identity?<p className="vision-mesh-fingerprint">{t("mesh.v1.ownKey")}: <code>{identity.fingerprint}</code></p>:null}
      {offer?<label className="vision-mesh-field">{t("mesh.v1.offer")}
        <textarea readOnly value={offer} rows={3} onFocus={e=>e.currentTarget.select()}/>
      </label>:null}
      <label className="vision-mesh-field">{t("mesh.v1.inspect")}
        <textarea value={incoming} maxLength={2048} rows={3} onChange={e=>setIncoming(e.target.value)}
          placeholder={t("mesh.v1.paste")}/>
      </label>
      <button type="button" className="ghost compact-button" onClick={()=>void inspectOffer()}
        disabled={pairingBusy||!incoming.trim()||!snapshot}>{t("mesh.v1.verify")}</button>
      {inspected?<p className="vision-mesh-fingerprint">{t("mesh.v1.verifiedNotPaired")}: <code>{inspected.fingerprint}</code></p>:null}
      </details>
      <details className="vision-mesh-advanced">
        <summary>{t("mesh.v2.title")}</summary>
      <p>{t("mesh.v2.notice")}</p>
      <div className="vision-mesh-stage-title">{t("mesh.v2.stepB")}</div>
      <button type="button" className="ghost compact-button" disabled={!incoming.trim()||pairingBusy||!snapshot}
        onClick={()=>void createChallenge()}>{t("mesh.v2.challengeButton")}</button>
      {challengeOutgoing?<label className="vision-mesh-field">{t("mesh.v2.challengeOutbound")}
        <textarea readOnly value={challengeOutgoing} rows={3} onFocus={e=>e.currentTarget.select()}/>
      </label>:null}
      <div className="vision-mesh-stage-title">{t("mesh.v2.stepA")}</div>
      <label className="vision-mesh-field">{t("mesh.v2.challengeInbound")}
        <textarea rows={3} maxLength={8192} value={challengeIncoming}
          onChange={e=>setChallengeIncoming(e.target.value)} placeholder={t("mesh.v2.pasteChallenge")}/>
      </label>
      <button type="button" className="ghost compact-button" disabled={!challengeIncoming.trim()||pairingBusy||!snapshot}
        onClick={()=>void createResponse()}>{t("mesh.v2.answerButton")}</button>
      {responseOutgoing?<label className="vision-mesh-field">{t("mesh.v2.responseOutbound")}
        <textarea readOnly rows={4} value={responseOutgoing} onFocus={e=>e.currentTarget.select()}/>
      </label>:null}
      {pairingProof?<p className="vision-mesh-sas"><strong>{t("mesh.v2.code")}:</strong> <code>{pairingProof.comparisonCode}</code></p>:null}
      <div className="vision-mesh-stage-title">{t("mesh.v2.stepBVerify")}</div>
      <label className="vision-mesh-field">{t("mesh.v2.responseInbound")}
        <textarea rows={4} maxLength={8192} value={responseIncoming}
          onChange={e=>setResponseIncoming(e.target.value)} placeholder={t("mesh.v2.pasteResponse")}/>
      </label>
      <button type="button" className="ghost compact-button" disabled={!responseIncoming.trim()||pairingBusy||!snapshot}
        onClick={()=>void verifyResponse()}>{t("mesh.v2.verifyButton")}</button>
      {pairingVerified?<p className="vision-mesh-sas"><strong>{t("mesh.v2.code")}:</strong> <code>{pairingVerified.comparisonCode}</code></p>:null}
      {(pairingProof||pairingVerified)?<p className="vision-mesh-warning">{t("mesh.v2.noTrust")}</p>:null}
      {(pairingProof||pairingVerified)?<div className="vision-mesh-approval">
        <strong>{t("mesh.v3.confirmTitle")}</strong>
        <p>{t("mesh.v3.confirmDescription")}</p>
        <label className="vision-mesh-field">{t("mesh.v3.confirmCode")}
          <input value={confirmedCode} maxLength={14}
            placeholder="AB12-34CD-EF09"
            autoComplete="off" onChange={e=>setConfirmedCode(e.target.value.toUpperCase())}/>
        </label>
        <button type="button" className="ghost compact-button"
          disabled={pairingBusy||!/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(confirmedCode)}
          onClick={()=>void approvePeer()}>{t("mesh.v3.confirmButton")}</button>
      </div>:null}
      </details>
      <details className="vision-mesh-approved">
        <summary>{t("mesh.v3.listTitle")}</summary>
        <p>{t("mesh.v3.listDisclaimer")}</p>
        <button type="button" className="ghost compact-button" disabled={pairingBusy||!snapshot}
          onClick={()=>void loadApproved()}>{t("mesh.v3.refresh")}</button>
        {approvedPeers && approvedPeers.length===0?<p>{t("mesh.v3.empty")}</p>:null}
        {approvedPeers?.map(peer=><div className="vision-mesh-peer" key={peer.fingerprint}>
          <div><small>{t("mesh.v3.locallyApproved")}</small>
            <code>{peer.fingerprint}</code></div>
          <button type="button" className="ghost compact-button"
            disabled={pairingBusy}
            onClick={()=>void revokePeer(peer.fingerprint)}>{t("mesh.v3.revoke")}</button>
        </div>)}
      </details>
      {approvalError?<p role="alert" className="vision-mesh-error">{t("mesh.v3.error")}</p>:null}
    </details>
    </div>
  </section>;
}
