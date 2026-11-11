// Created by NMKato Solutions
// KatoSync connections: isolated Mesh QA controller.
// UI is independent of Vision graph. Peer trust and remote jobs remain fail-closed.
import { ShieldCheck, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT, type TKey } from "../i18n";
import { classifyMeshIdentityFailure, type MeshIdentityFailure } from "../lib/meshIdentityDiagnosis";
import { activeMeshInvitations, nextMeshInboxExpiryDelay } from "../lib/meshInboxExpiry";
import {selectMeshColleague} from "../lib/meshAgentIntroduction35";
import {meshRegistrationAgentName,presentMeshRegistrations} from "../lib/meshDirectoryPresentation35";
import {canConfirmRelayPeerLocally} from "../lib/meshRelayLocalApproval35F";

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

type MeshAgentBootstrapSnapshot = {
  protocol:"katosync-mesh-agent-bootstrap-v35";
  agentName:string;
  fingerprint:string;
  hardware:{
    platform:string;architecture:string;chipFamily:string|null;logicalCpuCores:number;
    memoryGibBucket:number|null;recommendedRole:string;
    localModelStatus:"not_verified";
  };
  ownerSessionVerified:true;rosterDiscoveryAllowed:true;
  trustedPeers:0;transportReady:false;remoteJobsEnabled:false;
};

type MeshPresenceReceipt = {
  accepted:true;reportedRecently:true;paired:false;transportReady:false;
  remoteJobsEnabled:false;nextPollSeconds:number;
};

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

type MeshNativeIssuerReadiness = {
  protocol:"mesh-native-issuer-boundary-v1";
  compiledIssuer:"katoos_shared_qa"|"katosync_legacy"|"unknown_fail_closed";
  isolatedPreviewSession:"independent_login_required";
  currentSessionReusableForPreview:false;
  previewTokenStoreIsolated:false;
  previewCloudProbeEnabled:false;
  onlinePreviewVerified:false;
  devicePairingEnabled:false;
  remoteJobsEnabled:false;
};

type MeshNativePeerPreflight = {
  protocol:"katosync-mesh-native-peer-preflight-v1";
  admissionEligible:true;
  paired:false;
  transportReady:false;
  remoteJobsEnabled:false;
  verifiedPeers:0;
};

type MeshKatoosSharedPreflight = {
  protocol:"mesh-katoos-shared-preflight-v1";
  sharedIssuerVerified:true;
  schemaAccessible:true;
  membership:"active"|"not_member";
  discoveryAuthorized:boolean;
  paired:false;
  transportReady:false;
  remoteJobsEnabled:false;
};

type MeshPreviewAuthStatus = {
  protocol:"mesh-preview-auth-v1";
  configured:boolean;
  previewIssuerOnly:boolean;
  independentKeychain:boolean;
  sessionVerified:boolean;
  accountEmail:string|null;
  paired:false;
  transportReady:false;
  remoteJobsEnabled:false;
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
type MeshInboxSentReceipt = {
  requestId:string;
  expiresAt:string;
  deliveryOnly:true;
  paired:false;
  transportReady:false;
  remoteJobsEnabled:false;
};
type MeshReceivedItem = {
  requestId:string;
  sourceDeviceId:string;
  expiresAt:string;
  fingerprint:string;
  // Public sender offer, verified by Rust before crossing IPC.
  signedOffer:MeshSignedOffer;
};
type MeshReceivedInbox = {
  invitations:MeshReceivedItem[];
  paired:false;
  transportReady:false;
  remoteJobsEnabled:false;
};
type MeshReceivedDecision = {
  requestId:string;
  state:"accepted"|"rejected";
  decisionOnly:true;
  paired:false;
  transportReady:false;
  remoteJobsEnabled:false;
};
type RelayPublicMessage = {
  requestId:string; senderDeviceId:string; recipientDeviceId:string;
  kind:"challenge"|"response";payloadJson:string;expiresAt:number;
};
type RelayRead = {
  messages:RelayPublicMessage[];deliveryOnly:true;paired:false;
  transportReady:false;remoteJobsEnabled:false;
};
type RelayDelivery = {
  messageId:string;deliveryOnly:true;paired:false;
  transportReady:false;remoteJobsEnabled:false;
};
type RelayWork = {requestId:string;deviceId:string;payloadJson:string};
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
  // A user-visible pairing guide is NOT an authenticated transport session.
  const [guideOpen,setGuideOpen]=useState(false);
  const [selectedDeviceId,setSelectedDeviceId]=useState<string|null>(null);
  // Stage4I: explicit read-only admission report, never an active connection.
  const [nativePreflight,setNativePreflight]=useState<{
    deviceId:string;fingerprint:string;eligible:true;
  }|null>(null);
  const [nativePreflightError,setNativePreflightError]=useState(false);
  const [nativePreflightBusy,setNativePreflightBusy]=useState(false);
  const nativePreflightInFlight=useRef(false);
  const nativePreflightOperation=useRef(0);
  // Readiness is an ephemeral observation, never a durable permission.
  useEffect(()=>{
    if(!nativePreflight)return;
    const timeout=window.setTimeout(()=>setNativePreflight(null),30_000);
    return ()=>window.clearTimeout(timeout);
  },[nativePreflight]);
  // Synchronous guards survive double-clicks before React can re-render.
  // Epochs invalidate late async results after an account/surface refresh.
  const rosterOperation=useRef(0);
  const rosterInFlight=useRef(false);
  const inboxOperation=useRef(0);
  const inboxInFlight=useRef(false);
  const recipientOperation=useRef(0);
  const recipientInFlight=useRef(false);
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
  const [issuerSnapshot,setIssuerSnapshot]=useState<MeshNativeIssuerReadiness|null>(null);
  const [previewStatus,setPreviewStatus]=useState<MeshPreviewAuthStatus|null>(null);
  const [sharedPreflight,setSharedPreflight]=useState<MeshKatoosSharedPreflight|null>(null);
  const [sharedBusy,setSharedBusy]=useState(false);
  const [sharedError,setSharedError]=useState(false);
  const sharedRequest=useRef(0);
  const [previewEmail,setPreviewEmail]=useState("");
  const [previewPassword,setPreviewPassword]=useState("");
  const [previewBusy,setPreviewBusy]=useState(false);
  const [previewError,setPreviewError]=useState(false);
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
      // Reauth can switch the verified account, even when a subsequent
      // identity check fails. Never display an old account's device names.
      rosterOperation.current++;rosterInFlight.current=false;
      inboxOperation.current++;inboxInFlight.current=false;
      recipientOperation.current++;recipientInFlight.current=false;
      setDirectory(null);setSelectedDeviceId(null);setGuideOpen(false);
      nativePreflightOperation.current++;nativePreflightInFlight.current=false;
      setNativePreflight(null);setNativePreflightError(false);setNativePreflightBusy(false);
      setDirectoryError(false);setDirectoryIssue(null);
      setNativeInboxPrepared(null);setNativeInboxSent(null);
      setRecipientInbox(null);setRecipientDecision(null);
      resetRelay();
      challengeOperation.current++;challengeInFlight.current=false;
      setAcceptedInboxOffer(null);setAcceptedChallenge(null);setChallengeError(false);setChallengeBusy(false);
      setDirectoryBusy(false);setNativeInboxBusy(false);setRecipientBusy(false);
    }
  };
  const [directory,setDirectory]=useState<MeshAccountDirectory|null>(null);
  const [agentBootstrap,setAgentBootstrap]=useState<MeshAgentBootstrapSnapshot|null>(null);
  const lastPresenceAttempt=useRef(0);
  const presenceIdentity=useRef("");
  const [nativeInboxBusy,setNativeInboxBusy]=useState(false);
  const [nativeInboxError,setNativeInboxError]=useState(false);
  const [nativeInboxPrepared,setNativeInboxPrepared]=useState<string|null>(null);
  const [nativeInboxSent,setNativeInboxSent]=useState<string|null>(null);
  const [sentRequest,setSentRequest]=useState<{requestId:string;deviceId:string;expiresAt:string}|null>(null);
  const [recipientInbox,setRecipientInbox]=useState<MeshReceivedItem[]|null>(null);
  const [recipientBusy,setRecipientBusy]=useState(false);
  const [recipientError,setRecipientError]=useState(false);
  const [recipientDecision,setRecipientDecision]=useState<"accepted"|"rejected"|null>(null);
  const [acceptedInboxOffer,setAcceptedInboxOffer]=useState<MeshReceivedItem|null>(null);
  const [acceptedChallenge,setAcceptedChallenge]=useState<string|null>(null);
  const [challengeRelayWork,setChallengeRelayWork]=useState<RelayWork|null>(null);
  const [responseRelayWork,setResponseRelayWork]=useState<RelayWork|null>(null);
  const [relayMessages,setRelayMessages]=useState<RelayPublicMessage[]|null>(null);
  const [relayReceipt,setRelayReceipt]=useState<"challenge"|"response"|null>(null);
  const [relayProof,setRelayProof]=useState<MeshPairingProof|null>(null);
  const [relayBusy,setRelayBusy]=useState(false);
  const [relayError,setRelayError]=useState(false);
  const relayInFlight=useRef(false);
  const relayOperation=useRef(0);
  const resetRelay=()=>{
    relayOperation.current++;relayInFlight.current=false;
    setSentRequest(null);setChallengeRelayWork(null);setResponseRelayWork(null);
    setRelayMessages(null);setRelayReceipt(null);setRelayProof(null);
    setConfirmedCode("");
    setRelayBusy(false);setRelayError(false);
  };
  const [challengeError,setChallengeError]=useState(false);
  const [challengeBusy,setChallengeBusy]=useState(false);
  const challengeInFlight=useRef(false);
  const challengeOperation=useRef(0);
  const loadRecipientInbox=async()=>{
    if(import.meta.env.VITE_MESH_INBOX_RECEIVE_QA!=="1"||recipientInFlight.current)return;
    recipientInFlight.current=true;
    const operation=++recipientOperation.current;
    setRecipientBusy(true);setRecipientError(false);setRecipientDecision(null);setRecipientInbox(null);
    // A new inbox scan never silently revives an earlier accepted offer.
    challengeOperation.current++;challengeInFlight.current=false;
    setAcceptedInboxOffer(null);setAcceptedChallenge(null);setChallengeBusy(false);setChallengeError(false);
    setChallengeRelayWork(null);
    try{
      const result=await invoke<MeshReceivedInbox>("mesh_inbox_recipient_list");
      if(result.paired!==false||result.transportReady!==false||result.remoteJobsEnabled!==false||
         !Array.isArray(result.invitations)||result.invitations.length>10||
         result.invitations.some(item=>!item.requestId||!item.sourceDeviceId||
            !Number.isFinite(Date.parse(item.expiresAt))||
            !/^[0-9A-F]{2}(-[0-9A-F]{2}){15}$/.test(item.fingerprint)||
            item.signedOffer?.protocol!=="katosync-mesh-pairing-v1"||
            !/^[A-Za-z0-9_-]{43}$/.test(item.signedOffer.publicKey)||
            !/^[A-Za-z0-9_-]{43}$/.test(item.signedOffer.nonce)||
            !/^[A-Za-z0-9_-]{43}$/.test(item.signedOffer.accountScope)||
            !/^[A-Za-z0-9_-]{86}$/.test(item.signedOffer.signature)||
            item.signedOffer.expiresAt*1000!==Date.parse(item.expiresAt)))
        throw new Error("invalid_recipient_inbox");
      if(operation!==recipientOperation.current)return;
      // A message that expired while in flight is not a broken inbox.
      // It must never be selectable, even if the server list was once valid.
      setRecipientInbox(activeMeshInvitations(result.invitations));
    }catch{if(operation===recipientOperation.current)setRecipientError(true);}
    finally{if(operation===recipientOperation.current){
      recipientInFlight.current=false;setRecipientBusy(false);
    }}
  };
  useEffect(()=>{
    if(!recipientInbox?.length)return;
    const delay=nextMeshInboxExpiryDelay(recipientInbox);
    if(delay===null)return;
    // One cancellable expiry event, never a background inbox poll.
    const timer=window.setTimeout(()=>{
      setRecipientInbox(items=>items?activeMeshInvitations(items):null);
    },delay);
    return ()=>window.clearTimeout(timer);
  },[recipientInbox]);
  const decideRecipientInvite=async(item:MeshReceivedItem,action:"accept"|"reject")=>{
    if(import.meta.env.VITE_MESH_INBOX_RECEIVE_QA!=="1"||recipientInFlight.current||
       !recipientInbox?.some(x=>x.requestId===item.requestId)||Date.parse(item.expiresAt)<=Date.now())return;
    recipientInFlight.current=true;
    const operation=++recipientOperation.current;
    setRecipientBusy(true);setRecipientError(false);setRecipientDecision(null);
    try{
      const result=await invoke<MeshReceivedDecision>("mesh_inbox_recipient_decide",
        {requestId:item.requestId,action});
      if(result.requestId!==item.requestId||
         result.state!==(action==="accept"?"accepted":"rejected")||
         result.decisionOnly!==true||result.paired!==false||
         result.transportReady!==false||result.remoteJobsEnabled!==false)
        throw new Error("invalid_recipient_decision");
      if(operation!==recipientOperation.current)return;
      setRecipientInbox(list=>list?.filter(x=>x.requestId!==item.requestId)??null);
      if(result.state==="accepted"&&item.signedOffer.expiresAt*1000>Date.now()){
        setAcceptedInboxOffer(item);
      }else{
        setAcceptedInboxOffer(null);
      }
      setAcceptedChallenge(null);setChallengeRelayWork(null);setChallengeError(false);
      setRecipientDecision(result.state);
    }catch{if(operation===recipientOperation.current)setRecipientError(true);}
    finally{if(operation===recipientOperation.current){
      recipientInFlight.current=false;setRecipientBusy(false);
    }}
  };

  // The recipient may consciously move an ALREADY ACCEPTED, RUST-VERIFIED
  // public offer into the existing signed possession-challenge protocol.
  // No native command is invoked by merely receiving or accepting a request.
  const prepareAcceptedChallenge=async()=>{
    const accepted=acceptedInboxOffer;
    if(challengeInFlight.current||!accepted||accepted.signedOffer.expiresAt*1000<=Date.now())return;
    challengeInFlight.current=true;
    const operation=++challengeOperation.current;
    setChallengeBusy(true);setChallengeError(false);setAcceptedChallenge(null);
    try{
      const raw=await invoke<string>("mesh_pairing_challenge_create",
        {offerJson:JSON.stringify(accepted.signedOffer)});
      const challenge=JSON.parse(raw);
      if(challenge.protocol!=="katosync-mesh-challenge-v1"||
         challenge.offer?.protocol!==accepted.signedOffer.protocol||
         challenge.offer?.publicKey!==accepted.signedOffer.publicKey||
         challenge.offer?.nonce!==accepted.signedOffer.nonce||
         challenge.offer?.signature!==accepted.signedOffer.signature||
         challenge.offer?.accountScope!==accepted.signedOffer.accountScope||
         challenge.offer?.expiresAt!==accepted.signedOffer.expiresAt||
         !/^[A-Za-z0-9_-]{86}$/.test(challenge.signature)||
         !Number.isFinite(challenge.expiresAt)||
         challenge.expiresAt*1000<=Date.now()||
         challenge.expiresAt>accepted.signedOffer.expiresAt)
        throw new Error("unverified_native_challenge_receipt");
      if(operation===challengeOperation.current){
        setAcceptedChallenge(raw);
        setChallengeRelayWork({requestId:accepted.requestId,deviceId:accepted.sourceDeviceId,payloadJson:raw});
        setAcceptedInboxOffer(null);
      }
    }catch{if(operation===challengeOperation.current)setChallengeError(true);}
    finally{if(operation===challengeOperation.current){
      challengeInFlight.current=false;setChallengeBusy(false);
    }}
  };
  useEffect(()=>{
    if(!acceptedInboxOffer)return;
    const delay=nextMeshInboxExpiryDelay([acceptedInboxOffer]);
    if(delay===null){setAcceptedInboxOffer(null);return;}
    const timeout=window.setTimeout(()=>setAcceptedInboxOffer(null),delay);
    return ()=>window.clearTimeout(timeout);
  },[acceptedInboxOffer]);

  const [directoryBusy,setDirectoryBusy]=useState(false);
  const [directoryError,setDirectoryError]=useState(false);
  const [directoryIssue,setDirectoryIssue]=useState<"quota"|"rate"|"plan"|null>(null);
  const sendNativeInbox=async(targetDeviceId:string)=>{
    // A separate, explicitly activated QA-only command; no implicit send from discovery.
    if(import.meta.env.VITE_MESH_INBOX_SEND_QA!=="1"||inboxInFlight.current||
       nativeInboxSent===targetDeviceId||selectedDeviceId!==targetDeviceId||
       !directory?.devices.some(d=>d.deviceId===targetDeviceId&&d.membershipState==="discovered"))return;
    inboxInFlight.current=true;
    const operation=++inboxOperation.current;
    setNativeInboxBusy(true);setNativeInboxError(false);setNativeInboxSent(null);setNativeInboxPrepared(null);
    try{
      const result=await invoke<MeshInboxSentReceipt>("mesh_inbox_invite_send",{targetDeviceId});
      if(!result.requestId||!Number.isFinite(Date.parse(result.expiresAt))||
         Date.parse(result.expiresAt)<=Date.now()||
         result.deliveryOnly!==true||result.paired!==false||
         result.transportReady!==false||result.remoteJobsEnabled!==false)
        throw new Error("invalid_delivery_receipt");
      if(operation===inboxOperation.current){
        setNativeInboxSent(targetDeviceId);
        setSentRequest({requestId:result.requestId,deviceId:targetDeviceId,expiresAt:result.expiresAt});
      }
    }catch{if(operation===inboxOperation.current)setNativeInboxError(true);}
    finally{if(operation===inboxOperation.current){
      inboxInFlight.current=false;setNativeInboxBusy(false);
    }}
  };
  const prepareNativeInbox=async(targetDeviceId:string)=>{
    if(inboxInFlight.current||selectedDeviceId!==targetDeviceId||
       !directory?.devices.some(d=>d.deviceId===targetDeviceId&&d.membershipState==="discovered"))return;
    inboxInFlight.current=true;
    const operation=++inboxOperation.current;
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
      if(operation===inboxOperation.current)setNativeInboxPrepared(targetDeviceId);
    }catch{if(operation===inboxOperation.current)setNativeInboxError(true);}
    finally{if(operation===inboxOperation.current){
      inboxInFlight.current=false;setNativeInboxBusy(false);
    }}
  };
  const loadAccountDirectory=async(mode:"list"|"discover"="discover")=>{
    if(rosterInFlight.current)return;
    rosterInFlight.current=true;
    const operation=++rosterOperation.current;
    setDirectoryBusy(true);setDirectoryError(false);setDirectoryIssue(null);setDirectory(null);
    setSelectedDeviceId(null);
    nativePreflightOperation.current++;nativePreflightInFlight.current=false;
    setNativePreflight(null);setNativePreflightError(false);setNativePreflightBusy(false);
    setNativeInboxPrepared(null);setNativeInboxError(false);setNativeInboxSent(null);setRecipientInbox(null);setRecipientDecision(null);
    resetRelay();
    challengeOperation.current++;challengeInFlight.current=false;
    setAcceptedInboxOffer(null);setAcceptedChallenge(null);setChallengeBusy(false);setChallengeError(false);
    try{
      // Opening the guide only READS the signed-in account's existing roster.
      // The explicit "Find devices" button alone performs enrollment.
      const command=mode==="list"?"mesh_account_devices_list":"mesh_account_device_discover";
      const roster=await invoke<MeshAccountDirectory>(command);
      if(roster.accountVerified!==true || roster.discoveryOnly!==true ||
         roster.transportReady!==false || roster.remoteJobsEnabled!==false ||
         !Array.isArray(roster.devices) || roster.devices.length>10 ||
         roster.devices.some(d=>!d.deviceId||!d.displayName||!d.fingerprint||
           !["macos","windows","linux"].includes(d.platformOs)||
           !["discovered","pending","trusted","revoked"].includes(d.membershipState)))
        throw new Error("invalid_directory_contract");
      if(operation===rosterOperation.current)setDirectory(roster);
    }catch(cause){
      if(operation===rosterOperation.current){
        const code=String(cause);
        setDirectoryIssue(code.includes("MESH_DISCOVERY_DEVICE_QUOTA")?"quota":
          code.includes("MESH_DISCOVERY_RATE_LIMIT")?"rate":
          code.includes("MESH_DISCOVERY_PRO_REQUIRED")?"plan":null);
        setDirectoryError(true);
      }
    }
    finally{if(operation===rosterOperation.current){
      rosterInFlight.current=false;setDirectoryBusy(false);
    }}
  };
  // Stage 3.5: authenticated first-start auto-introduction, read-only roster refresh.
  // Never enroll silently, accept an invitation, connect TLS or transmit job data.
  useEffect(()=>{
    if(import.meta.env.VITE_KATOOS_AUTH_QA!=="1")return;
    let active=true;
    let checking=false;
    let timer:number|undefined;
    const checkColleagues=async()=>{
      if(checking)return;
      if(rosterInFlight.current || inboxInFlight.current ||
         recipientInFlight.current || relayInFlight.current){
        // Retry after a foreground Mesh operation. Never let a busy one-off
        // leave the background roster/heartbeat scheduler permanently stopped.
        timer=window.setTimeout(()=>void checkColleagues(),30_000);
        return;
      }
      checking=true;
      try{
        const status=await invoke<{loggedIn:boolean}>("supabase_session_status");
        if(!active)return;
        if(status.loggedIn!==true){
          setAgentBootstrap(null);
          setDirectory(null);
          lastPresenceAttempt.current=0;
          presenceIdentity.current="";
          return;
        }
        const myAgent=await invoke<MeshAgentBootstrapSnapshot>("mesh_agent_bootstrap_snapshot");
        if(!active)return;
        if(myAgent.protocol!=="katosync-mesh-agent-bootstrap-v35"||
           myAgent.ownerSessionVerified!==true||
           myAgent.rosterDiscoveryAllowed!==true||
           myAgent.transportReady!==false||myAgent.remoteJobsEnabled!==false||
           !myAgent.fingerprint||!myAgent.agentName)throw Error("invalid_bootstrap");
        const rosterOperationAtStart=rosterOperation.current;
        const roster=await invoke<MeshAccountDirectory>("mesh_account_devices_list");
        // A manual discovery or account refresh invalidates this background read.
        if(rosterOperationAtStart!==rosterOperation.current)return;
        // Revalidate the identity after I/O to guard against account switching.
        const stillMe=await invoke<MeshAgentBootstrapSnapshot>("mesh_agent_bootstrap_snapshot");
        if(!active || rosterOperationAtStart!==rosterOperation.current ||
           stillMe.fingerprint!==myAgent.fingerprint)return;
        if(roster.accountVerified!==true || roster.discoveryOnly!==true ||
           roster.transportReady!==false || roster.remoteJobsEnabled!==false ||
           !Array.isArray(roster.devices) || roster.devices.length>10 ||
           roster.devices.some(d=>!d.deviceId||!d.ownerUserId||!d.displayName||
             !d.fingerprint||!["discovered","pending","trusted","revoked"].includes(d.membershipState)))
          return;
        setAgentBootstrap(myAgent);
        setDirectory(roster);
        if(presenceIdentity.current!==myAgent.fingerprint){
          presenceIdentity.current=myAgent.fingerprint;
          lastPresenceAttempt.current=0;
        }
        // Optional signed QA heartbeat; never claims P2P connectivity.
        // No implicit registration: native refuses unknown/revoked identities.
        const presenceEnabled=import.meta.env.VITE_STAGE35_HEARTBEAT_QA==="1";
        const enrolled=roster.devices.some(d=>d.fingerprint===myAgent.fingerprint &&
          d.membershipState!=="revoked");
        if(presenceEnabled&&enrolled&&Date.now()-lastPresenceAttempt.current>=600_000){
          lastPresenceAttempt.current=Date.now();
          try{
            const receipt=await invoke<MeshPresenceReceipt>("mesh_device_presence_report");
            if(!receipt.accepted||!receipt.reportedRecently||receipt.paired||
               receipt.transportReady||receipt.remoteJobsEnabled||
               receipt.nextPollSeconds<300||receipt.nextPollSeconds>3600)
              throw Error("invalid_presence_receipt");
          }catch{
            // Network errors do not imply the peer is offline or trusted.
            // Keep the last verified directory, retry after a bounded pause.
          }
        }
      }catch{
        // A failed background check is not proof of lost peer trust.
        // Keep any manually verified pairing state; never auto-create access.
      }finally{
        checking=false;
        // A single future read, never an overlapping interval.
        if(active)timer=window.setTimeout(()=>void checkColleagues(),120_000);
      }
    };
    void checkColleagues();
    return ()=>{active=false;if(timer!==undefined)window.clearTimeout(timer);};
    // Session checks happen inside the native command, not using a JS token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[refreshEpoch]);

  const startConnectionGuide=()=>{
    setGuideOpen(true);
    if(!directory&&!directoryBusy)void loadAccountDirectory("list");
  };
  const discoverDevices=()=>{
    setGuideOpen(true);
    void loadAccountDirectory("discover");
  };
  // Stage 3I is available only with BOTH the QA Web flag and the QA native
  // build flag; the actual Edge endpoint has an independent server opt-in.
  const relayQa=import.meta.env.VITE_KATOOS_AUTH_QA==="1"&&
    import.meta.env.VITE_MESH_RELAY_QA==="1";
  const sendRelay=async(work:RelayWork,kind:"challenge"|"response")=>{
    if(!relayQa||relayInFlight.current)return;
    let expires:number;
    try {
      const payload=JSON.parse(work.payloadJson);
      expires=kind==="challenge"?payload.expiresAt:payload.challenge?.expiresAt;
    }catch{return;}
    if(!Number.isSafeInteger(expires)||expires*1000<=Date.now())return;
    relayInFlight.current=true;const operation=++relayOperation.current;
    setRelayBusy(true);setRelayError(false);setRelayReceipt(null);
    try{
      const result=await invoke<RelayDelivery>("mesh_pairing_relay_send",{
        requestId:work.requestId,recipientDeviceId:work.deviceId,
        kind,payloadJson:work.payloadJson
      });
      if(!/^[0-9a-f-]{36}$/i.test(result.messageId)||result.deliveryOnly!==true||
         result.paired!==false||result.transportReady!==false||result.remoteJobsEnabled!==false)
        throw new Error("invalid_relay_receipt");
      if(operation===relayOperation.current){
        setRelayReceipt(kind);
        if(kind==="challenge")setChallengeRelayWork(null);
        else setResponseRelayWork(null);
      }
    }catch{if(operation===relayOperation.current)setRelayError(true);}
    finally{if(operation===relayOperation.current){
      relayInFlight.current=false;setRelayBusy(false);
    }}
  };
  const loadRelay=async()=>{
    if(!relayQa||relayInFlight.current)return;
    relayInFlight.current=true;const operation=++relayOperation.current;
    setRelayBusy(true);setRelayError(false);setRelayMessages(null);
    try{
      const data=await invoke<RelayRead>("mesh_pairing_relay_list");
      if(data.deliveryOnly!==true||data.paired!==false||
         data.transportReady!==false||data.remoteJobsEnabled!==false||
         !Array.isArray(data.messages)||data.messages.length>10||
         data.messages.some(m=>!["challenge","response"].includes(m.kind)||
           !/^[0-9a-f-]{36}$/i.test(m.requestId)||m.expiresAt*1000<=Date.now()||
           !m.senderDeviceId||!m.recipientDeviceId||
           m.payloadJson.length>8192))throw new Error("invalid_relay_list");
      if(operation===relayOperation.current)setRelayMessages(data.messages);
    }catch{if(operation===relayOperation.current)setRelayError(true);}
    finally{if(operation===relayOperation.current){
      relayInFlight.current=false;setRelayBusy(false);
    }}
  };
  const prepareRelayResponse=async(item:RelayPublicMessage)=>{
    if(!relayQa||relayInFlight.current||item.kind!=="challenge"||
       !relayMessages?.includes(item)||item.expiresAt*1000<=Date.now())return;
    relayInFlight.current=true;const operation=++relayOperation.current;
    setRelayBusy(true);setRelayError(false);setResponseRelayWork(null);setRelayProof(null);
    try{
      const [publicJson,proof]=await invoke<[string,MeshPairingProof]>(
        "mesh_pairing_response_create",{challengeJson:item.payloadJson}
      );
      if(JSON.parse(publicJson)?.protocol!=="katosync-mesh-response-v1"||
         proof.paired!==false||proof.peerCount!==0||proof.transportReady!==false||
         !/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(proof.comparisonCode))
        throw new Error("invalid_relay_response");
      if(operation===relayOperation.current){
        setResponseRelayWork({requestId:item.requestId,deviceId:item.senderDeviceId,payloadJson:publicJson});
        setRelayProof(proof);
        setRelayMessages(null);
      }
    }catch{if(operation===relayOperation.current)setRelayError(true);}
    finally{if(operation===relayOperation.current){
      relayInFlight.current=false;setRelayBusy(false);
    }}
  };
  const verifyRelayResponse=async(item:RelayPublicMessage)=>{
    if(!relayQa||relayInFlight.current||item.kind!=="response"||
       !relayMessages?.includes(item)||item.expiresAt*1000<=Date.now())return;
    relayInFlight.current=true;const operation=++relayOperation.current;
    setRelayBusy(true);setRelayError(false);setRelayProof(null);
    try{
      const proof=await invoke<MeshPairingProof>("mesh_pairing_response_verify",
        {responseJson:item.payloadJson});
      if(proof.paired!==false||proof.peerCount!==0||proof.transportReady!==false||
        !/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(proof.comparisonCode))
        throw new Error("invalid_relay_proof");
      if(operation===relayOperation.current){
        setConfirmedCode("");
        setRelayProof(proof);
        setRelayMessages(null);
      }
    }catch{if(operation===relayOperation.current)setRelayError(true);}
    finally{if(operation===relayOperation.current){
      relayInFlight.current=false;setRelayBusy(false);
    }}
  };
  const selectedDevice=directory?.devices.find(d=>d.deviceId===selectedDeviceId &&
    d.fingerprint!==agentBootstrap?.fingerprint)??null;
  // A manual preflight checks existing Keychain pin + current owner + RLS
  // enrollment. It never creates a key, pairs a device or opens a socket.
  const runNativePeerPreflight=async(device:MeshAccountDevice)=>{
    if(!qaAuthEnabled||nativePreflightInFlight.current||
       selectedDeviceId!==device.deviceId||device.membershipState==="revoked"||
       !/^[0-9A-F]{2}(-[0-9A-F]{2}){15}$/.test(device.fingerprint))return;
    nativePreflightInFlight.current=true;
    const operation=++nativePreflightOperation.current;
    setNativePreflight(null);setNativePreflightError(false);setNativePreflightBusy(true);
    try{
      const result=await invoke<MeshNativePeerPreflight>(
        "mesh_native_peer_preflight",{requestedFingerprint:device.fingerprint});
      if(result.protocol!=="katosync-mesh-native-peer-preflight-v1"||
         result.admissionEligible!==true||result.paired!==false||
         result.transportReady!==false||result.remoteJobsEnabled!==false||
         result.verifiedPeers!==0)throw Error("unexpected_mesh_trust");
      if(operation===nativePreflightOperation.current){
        setNativePreflight({deviceId:device.deviceId,
          fingerprint:device.fingerprint,eligible:true});
      }
    }catch{
      if(operation===nativePreflightOperation.current)setNativePreflightError(true);
    }finally{
      if(operation===nativePreflightOperation.current){
        nativePreflightInFlight.current=false;setNativePreflightBusy(false);
      }
    }
  };
  // Relay proof alone never grants trust. Selected target and independently
  // entered OTHER device's SAS must match the locally verified public key.
  const relayApprovalEligible=canConfirmRelayPeerLocally({
    proof:relayProof,selectedPeer:selectedDevice,
    codeFromOtherDevice:confirmedCode.trim().toUpperCase(),
    busy:pairingBusy||relayBusy||directoryBusy
  });
  const qaAuthEnabled=import.meta.env.VITE_KATOOS_AUTH_QA==="1";
  const inboxSendEnabled=qaAuthEnabled&&import.meta.env.VITE_MESH_INBOX_SEND_QA==="1";
  const inboxReceiveEnabled=qaAuthEnabled&&import.meta.env.VITE_MESH_INBOX_RECEIVE_QA==="1";
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
    // An updated local pin inventory invalidates any earlier admission result.
    nativePreflightOperation.current++;nativePreflightInFlight.current=false;
    setNativePreflight(null);setNativePreflightError(false);setNativePreflightBusy(false);
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
      setPairingProof(null);setPairingVerified(null);setRelayProof(null);
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
    sharedRequest.current++;
    setSharedPreflight(null);setSharedError(false);setSharedBusy(false);
    setLoading(true);
    try {
      if(!window.__TAURI_INTERNALS__) {
        setSnapshot(null);
        setIssuerSnapshot(null);
        setPreviewStatus(null);
        setError(false);
        return;
      }
      const [actual,issuer,preview]=await Promise.all([
        invoke<MeshLocalReadiness>("mesh_local_readiness"),
        invoke<MeshNativeIssuerReadiness>("mesh_native_issuer_readiness").catch(()=>null),
        invoke<MeshPreviewAuthStatus>("mesh_preview_auth_status").catch(()=>null)
      ]);
      if(actual.protocol!=="mesh-readonly-v0" || actual.deviceIdentity!=="not_paired" ||
        actual.peerTransport!=="not_connected" || actual.verifiedPeers!==0 ||
        actual.remoteReadOnlyDispatch || actual.crossDeviceWrites) {
        throw new Error("unexpected_mesh_security_contract");
      }
      const issuerValid=issuer?.protocol==="mesh-native-issuer-boundary-v1"&&
        issuer.isolatedPreviewSession==="independent_login_required"&&
        issuer.currentSessionReusableForPreview===false&&
        issuer.previewTokenStoreIsolated===false&&
        issuer.previewCloudProbeEnabled===false&&
        issuer.onlinePreviewVerified===false&&
        issuer.devicePairingEnabled===false&&issuer.remoteJobsEnabled===false;
      setIssuerSnapshot(issuerValid?issuer:null);
      const previewValid=preview?.protocol==="mesh-preview-auth-v1"&&
        preview.paired===false&&preview.transportReady===false&&
        preview.remoteJobsEnabled===false&&preview.sessionVerified===false&&
        (!preview.configured||(preview.previewIssuerOnly&&preview.independentKeychain));
      setPreviewStatus(previewValid?preview:null);
      setSnapshot(actual);
      setError(false);
    } catch {
      setSnapshot(null);
      setIssuerSnapshot(null);
      setPreviewStatus(null);
      setError(true);
    } finally {setLoading(false);}
  },[]);
  useEffect(()=>{
    // A status refresh is deliberately read-only: do NOT invoke
    // mesh_account_device_discover (which registers the local device).
    // Old discovered roster rows must not look freshly verified.
    // Any response started before this refresh must not revive an old
    // account's roster, pending send or incoming invitations.
    rosterOperation.current++;rosterInFlight.current=false;
    inboxOperation.current++;inboxInFlight.current=false;
    recipientOperation.current++;recipientInFlight.current=false;
    challengeOperation.current++;challengeInFlight.current=false;
    setAcceptedInboxOffer(null);setAcceptedChallenge(null);setChallengeBusy(false);setChallengeError(false);
    resetRelay();
    setDirectory(null);
    setSelectedDeviceId(null);
    setNativeInboxSent(null);setNativeInboxPrepared(null);
    setRecipientInbox(null);setRecipientDecision(null);
    setDirectoryBusy(false);setNativeInboxBusy(false);setRecipientBusy(false);
    setGuideOpen(false);
    setDirectoryError(false);setDirectoryIssue(null);
    void refresh();
  },[refresh,refreshEpoch]);
  const checkSharedKatoos=async()=>{
    if(sharedBusy||issuerSnapshot?.compiledIssuer!=="katoos_shared_qa")return;
    const current=++sharedRequest.current;
    setSharedBusy(true);setSharedError(false);setSharedPreflight(null);
    try{
      const result=await invoke<MeshKatoosSharedPreflight>("mesh_katoos_shared_preflight");
      if(result.protocol!=="mesh-katoos-shared-preflight-v1"||
        result.sharedIssuerVerified!==true||result.schemaAccessible!==true||
        !["active","not_member"].includes(result.membership)||
        result.discoveryAuthorized!==(result.membership==="active")||
        result.paired!==false||result.transportReady!==false||
        result.remoteJobsEnabled!==false)throw new Error("invalid_shared_sso_contract");
      if(current===sharedRequest.current)setSharedPreflight(result);
    }catch{
      if(current===sharedRequest.current)setSharedError(true);
    }finally{
      if(current===sharedRequest.current)setSharedBusy(false);
    }
  };
  const previewAuthAction=async(action:"login"|"verify"|"logout")=>{
    if(previewBusy||!previewStatus?.configured)return;
    setPreviewBusy(true);
    setPreviewError(false);
    try {
      const command=action==="login"?"mesh_preview_auth_login":
        action==="verify"?"mesh_preview_auth_verify_session":"mesh_preview_auth_logout";
      const args=action==="login"?{email:previewEmail.trim(),password:previewPassword}:{};
      const result=await invoke<MeshPreviewAuthStatus>(command,args);
      if(result.protocol!=="mesh-preview-auth-v1"||!result.configured||
        !result.previewIssuerOnly||!result.independentKeychain||
        result.paired||result.transportReady||result.remoteJobsEnabled||
        (action==="logout"&&result.sessionVerified)||
        (action!=="logout"&&(!result.sessionVerified||!result.accountEmail))) {
        throw new Error("preview_contract_mismatch");
      }
      setPreviewStatus(result);
    }catch{
      setPreviewError(true);
      setPreviewStatus(previous=>previous?{...previous,sessionVerified:false,accountEmail:null}:null);
    }finally{
      setPreviewPassword("");
      setPreviewBusy(false);
    }
  };
  const presentation=directory&&agentBootstrap?presentMeshRegistrations({
    devices:directory.devices,
    localFingerprint:agentBootstrap.fingerprint,
    nowMs:Date.now()
  }):null;
  const myRosterDevice=presentation?.own||
    directory?.devices.find(d=>d.fingerprint===agentBootstrap?.fingerprint);
  const colleagueRecommendation=agentBootstrap&&myRosterDevice?
    selectMeshColleague({
      accountVerified:true,ownerUserId:myRosterDevice.ownerUserId,
      ownDeviceId:myRosterDevice.deviceId,
      devices:directory?.devices.map(d=>({
        deviceId:d.deviceId,ownerUserId:d.ownerUserId,displayName:d.displayName,
        agentName:d.personaName||d.displayName,fingerprint:d.fingerprint,
        membershipState:d.membershipState,
        // Only the native Keychain + authenticated SAS proof can authorize trust.
        locallyPinned:false,peerProofVerified:false,secureTransportReady:false
      }))||[]
    }):null;
  const authRejected=identityError&&
    ["account","session","refresh","invalid","changed"].includes(identityFailure??"");
  const revealReauth=()=>{
    setDetailsOpen(true);
    setReauthOpen(true);
  };
  const displayRegistrationName=(device:MeshAccountDevice)=>
    device.personaName||meshRegistrationAgentName(device.fingerprint,device.platformOs)||
    device.displayName;
  const registeredPlatform=(os:MeshAccountDevice["platformOs"])=>
    t(os==="macos"?"mesh.directory.deviceMac":
      os==="windows"?"mesh.directory.deviceWindows":"mesh.directory.deviceLinux");
  const readiness=snapshot?.localControl??"unknown";
  const renderRegistration=(device:MeshAccountDevice)=><button type="button"
    className="vision-mesh-guide-device" key={device.deviceId}
    aria-pressed={selectedDeviceId===device.deviceId}
    disabled={directoryBusy||nativeInboxBusy||recipientBusy}
    onClick={()=>{
      nativePreflightOperation.current++;nativePreflightInFlight.current=false;
      setNativePreflight(null);setNativePreflightError(false);setNativePreflightBusy(false);
      setSelectedDeviceId(device.deviceId);
    }}>
    <span className="vision-mesh-guide-device-name"><strong>{displayRegistrationName(device)}</strong>
      <small>{device.displayName}</small>
      <small>{registeredPlatform(device.platformOs)} · {t("mesh.directory.modelUnverified")}</small>
      <small>{t(("mesh.directory."+device.membershipState) as TKey)} · {t("mesh.directory.identitySuffix",{id:device.fingerprint.slice(-8)})}</small>
      <small>{device.lastSeenAt?
        t("mesh.directory.lastSeen",{time:relativeTime(device.lastSeenAt,lang)||"—"}):
        t("mesh.directory.notSeen")}</small>
    </span>
    <span className="vision-mesh-guide-select">{t(selectedDeviceId===device.deviceId?
      "mesh.guide.selected":"mesh.guide.choose")}</span>
  </button>;
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
          onClick={discoverDevices}>
          <RefreshCcw size={15} className={directoryBusy?"spin":""}/>
          {t("mesh.directory.refresh")}
        </button>
        <button type="button" className="primary compact-button"
          disabled={pairingBusy||!snapshot}
          onClick={startConnectionGuide}>{t("mesh.simple.connect")}</button>
        <button type="button" className="ghost compact-button" aria-expanded={detailsOpen}
          aria-controls="vision-mesh-technical-details"
          onClick={()=>setDetailsOpen(value=>!value)}>{t("mesh.simple.details")}</button>
      </div>
    </div>
    {agentBootstrap?<div className="vision-mesh-compact-notice" role="status">
      <strong>{t("mesh.agent35.identity",{name:agentBootstrap.agentName})}</strong>
      <small>{t("mesh.agent35.hardware",{
        cores:agentBootstrap.hardware.logicalCpuCores,
        memory:agentBootstrap.hardware.memoryGibBucket??"?",
        platform:agentBootstrap.hardware.chipFamily||agentBootstrap.hardware.platform
      })}</small>
      <small>{colleagueRecommendation?.stage==="ready_for_hello"?
        t("mesh.agent35.colleague",{name:colleagueRecommendation.peerName||"KAI"}):
        presentation?.registeredPeers?
          t("mesh.agent35.accountRecords",{count:presentation.registeredPeers}):
          t("mesh.agent35.noColleagues")}</small>
      <small>{t("mesh.agent35.pendingTrust")}</small>
    </div>:null}
    {offer?<div className="vision-mesh-compact-notice" role="status">
      <span>{t("mesh.simple.offerReady")}</span>
      <button type="button" className="ghost compact-button"
        onClick={()=>void copyPublicMessage(offer)}>{t("mesh.quick.copyPublicInvite")}</button>
    </div>:null}
    {directoryError&&!guideOpen?<p className="vision-mesh-compact-notice" role="status">
      {directoryIssue==="quota"?t("mesh.directory.quotaReached"):
       directoryIssue==="rate"?t("mesh.directory.rateLimited"):
       directoryIssue==="plan"?t("mesh.directory.proRequired"):
       t("mesh.simple.discoveryNotReady")}</p>:null}
    {directory?.devices.length===0&&!guideOpen?<p className="vision-mesh-compact-notice" role="status">
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
    {guideOpen?<div className="vision-mesh-guide" role="region"
      aria-label={t("mesh.guide.heading")}>
      <div className="vision-mesh-guide-heading">
        <strong>{t("mesh.guide.heading")}</strong>
        <small>{t("mesh.guide.notConnected")}</small>
      </div>
      <p>{t("mesh.guide.description")}</p>
      {!inboxSendEnabled?<p className="vision-mesh-compact-notice" role="status">
        {t("mesh.guide.deliveryDisabled")}</p>:null}
      {!inboxReceiveEnabled?<p className="vision-mesh-compact-notice" role="status">
        {t("mesh.recipient.disabled")}</p>:null}
    <section className="vision-mesh-account-directory" aria-label={t("mesh.directory.heading")}>
      <div className="vision-mesh-directory-heading">
        <strong>{t("mesh.directory.heading")}</strong>
        <span className="vision-mesh-directory-note">{t("mesh.simple.discoveryStatus")}</span>
      </div>
      <p>{t("mesh.directory.notice")}</p>
      {directory===null&&!directoryBusy&&!directoryError?
        <p>{t("mesh.guide.notLoaded")}</p>:null}
      {directoryBusy?<p role="status">{t("mesh.guide.loading")}</p>:null}
      {directory?.devices.length===0?<p role="status">{t("mesh.directory.empty")}</p>:null}
      {directory?<p className="vision-mesh-registration-summary" role="status">
        {t("mesh.directory.identityCount",{count:presentation?.totalIdentities??directory.devices.length})}
      </p>:null}
      {presentation?<>
        {presentation.own?<div className="vision-mesh-own-registration">
          <strong>{t("mesh.directory.own")}</strong>
          <small>{displayRegistrationName(presentation.own)} · {t("mesh.directory.registered")}</small>
          <small>{registeredPlatform(presentation.own.platformOs)} · {agentBootstrap?.hardware.chipFamily||t("mesh.directory.modelUnverified")}</small>
        </div>:null}
        {presentation.recentlyReported.length>0?
          <p className="vision-mesh-registration-section-label">
            {t("mesh.directory.recent")}
          </p>:null}
        {presentation.recentlyReported.map(renderRegistration)}
        {presentation.olderEntries.length>0?<details className="vision-mesh-older-registrations">
          <summary>{t("mesh.directory.older",{count:presentation.olderEntries.length})}</summary>
          <p>{t("mesh.directory.olderNotice")}</p>
          {presentation.olderEntries.map(renderRegistration)}
        </details>:null}
      </>:directory?.devices.map(renderRegistration)}
      {selectedDevice?<div className="vision-mesh-guide-target" role="group"
        aria-label={t("mesh.guide.target")}>
        <strong>{selectedDevice.personaName||selectedDevice.displayName}</strong>
        {selectedDevice.membershipState==="discovered"&&qaAuthEnabled?
          inboxSendEnabled?
            <button type="button" className="primary compact-button"
              disabled={nativeInboxBusy||directoryBusy||recipientBusy||
                nativeInboxSent===selectedDevice.deviceId}
              onClick={()=>void sendNativeInbox(selectedDevice.deviceId)}>{t("mesh.inbox.send")}</button>:
            <details className="vision-mesh-older-registrations">
              <summary>{t("mesh.guide.advancedPreparation")}</summary>
              <p>{t("mesh.guide.preparationDoesNotSend")}</p>
              <button type="button" className="ghost compact-button"
                disabled={nativeInboxBusy||directoryBusy||recipientBusy}
                onClick={()=>void prepareNativeInbox(selectedDevice.deviceId)}>{t("mesh.inbox.prepare")}</button>
            </details>:
          <small>{t("mesh.guide.sendUnavailable")}</small>}
        {qaAuthEnabled&&selectedDevice.membershipState!=="revoked"?<>
          <button type="button" className="ghost compact-button"
            disabled={nativePreflightBusy||directoryBusy||pairingBusy}
            onClick={()=>void runNativePeerPreflight(selectedDevice)}>
            <RefreshCcw size={14} className={nativePreflightBusy?"spin":""}/>
            {t("mesh.nativePreflight.check")}
          </button>
          {nativePreflight?.deviceId===selectedDevice.deviceId&&
           nativePreflight.fingerprint===selectedDevice.fingerprint?
            <small role="status">{t("mesh.nativePreflight.eligible")}</small>:null}
          {nativePreflightError?<small role="alert" className="vision-mesh-error">
            {t("mesh.nativePreflight.blocked")}</small>:null}
          <small>{t("mesh.nativePreflight.noTrust")}</small>
        </>:null}
        <small>{t("mesh.inbox.noTrust")}</small>
      </div>:null}
      {nativeInboxSent?<p role="status" className="vision-mesh-compact-notice">
        {t("mesh.inbox.sent")} {t("mesh.inbox.noTrust")}
      </p>:null}
      {nativeInboxPrepared?<p role="status" className="vision-mesh-compact-notice">
        {t("mesh.inbox.prepared")} {t("mesh.inbox.notSent")}
      </p>:null}
      {nativeInboxError?<p role="alert" className="vision-mesh-error">
        {t("mesh.inbox.failed")}
      </p>:null}
      {directoryError?<p role="alert">{directoryIssue==="quota"?t("mesh.directory.quotaReached"):
        directoryIssue==="rate"?t("mesh.directory.rateLimited"):
        directoryIssue==="plan"?t("mesh.directory.proRequired"):
        t("mesh.directory.unavailable")}</p>:null}
      {inboxReceiveEnabled?<section className="vision-mesh-recipient-inbox"
         aria-label={t("mesh.recipient.heading")}>
        <strong>{t("mesh.recipient.heading")}</strong>
        <p>{t("mesh.recipient.notice")}</p>
        <button type="button" className="ghost compact-button"
          disabled={recipientBusy||directoryBusy}
          onClick={()=>void loadRecipientInbox()}>{t("mesh.recipient.refresh")}</button>
        {recipientInbox?.length===0?<p role="status">{t("mesh.recipient.empty")}</p>:null}
        {recipientInbox?.map(item=><div className="vision-mesh-directory-row" key={item.requestId}>
          <div>
            <strong>{directory?.devices.find(d=>d.deviceId===item.sourceDeviceId)?.displayName||
              t("mesh.recipient.unknownSource")}</strong>
            <small>{t("mesh.recipient.expires")}: {relativeTime(item.expiresAt,lang)||"—"}</small>
            <small>{item.fingerprint}</small>
          </div>
          <button type="button" className="ghost compact-button" disabled={recipientBusy}
            onClick={()=>void decideRecipientInvite(item,"accept")}>{t("mesh.recipient.accept")}</button>
          <button type="button" className="ghost compact-button" disabled={recipientBusy}
            onClick={()=>void decideRecipientInvite(item,"reject")}>{t("mesh.recipient.reject")}</button>
        </div>)}
        {recipientDecision?<p role="status">
          {t(recipientDecision==="accepted"?"mesh.recipient.accepted":"mesh.recipient.rejected")}
          {" "}{t("mesh.recipient.notConnected")}
        </p>:null}
        {acceptedInboxOffer?<div className="vision-mesh-guide-target" role="group"
           aria-label={t("mesh.handoff.heading")}>
          <strong>{t("mesh.handoff.heading")}</strong>
          <p>{t("mesh.handoff.description")}</p>
          <button type="button" className="ghost compact-button"
             disabled={challengeBusy||recipientBusy||acceptedInboxOffer.signedOffer.expiresAt*1000<=Date.now()}
             onClick={()=>void prepareAcceptedChallenge()}>
            {t("mesh.handoff.createChallenge")}</button>
          <small>{t("mesh.inbox.noTrust")}</small>
        </div>:null}
        {acceptedChallenge?<div className="vision-mesh-guide-target" role="status">
          <strong>{t("mesh.handoff.ready")}</strong>
          <p>{t(relayQa?"mesh.relay.signedReady":"mesh.handoff.next")}</p>
          {relayQa&&challengeRelayWork?
            <button type="button" className="primary compact-button"
               disabled={relayBusy} onClick={()=>void sendRelay(challengeRelayWork,"challenge")}>
              {t("mesh.relay.sendChallenge")}</button>:null}
          <button type="button" className="ghost compact-button"
             onClick={()=>void copyPublicMessage(acceptedChallenge)}>
            {t("mesh.handoff.copyChallenge")}</button>
          <small>{t("mesh.recipient.notConnected")}</small>
        </div>:null}
        {challengeError?<p role="alert" className="vision-mesh-error">
          {t("mesh.handoff.failed")}</p>:null}
        {recipientError?<p role="alert" className="vision-mesh-error">
          {t("mesh.recipient.failed")}
        </p>:null}
      </section>:null}
      {relayQa?<section className="vision-mesh-recipient-inbox"
        aria-label={t("mesh.relay.heading")}>
        <strong>{t("mesh.relay.heading")}</strong>
        <p>{t("mesh.relay.notice")}</p>
        {sentRequest?<small>{t("mesh.relay.sentInvite")}: {sentRequest.requestId}</small>:null}
        <button type="button" className="ghost compact-button"
          disabled={relayBusy||directoryBusy||recipientBusy}
          onClick={()=>void loadRelay()}>{t("mesh.relay.check")}</button>
        {relayMessages?.length===0?<p role="status">{t("mesh.relay.empty")}</p>:null}
        {relayMessages?.map(item=><div className="vision-mesh-guide-target" key={item.requestId+item.kind}>
          <strong>{t(item.kind==="challenge"?"mesh.relay.challengeReceived":"mesh.relay.responseReceived")}</strong>
          <small>{t("mesh.recipient.expires")}: {relativeTime(new Date(item.expiresAt*1000).toISOString(),lang)||"—"}</small>
          <button type="button" className="ghost compact-button"
            disabled={relayBusy||item.expiresAt*1000<=Date.now()}
            onClick={()=>void(item.kind==="challenge"?
              prepareRelayResponse(item):verifyRelayResponse(item))}>
            {t(item.kind==="challenge"?"mesh.relay.prepareResponse":"mesh.relay.verifyResponse")}
          </button>
        </div>)}
        {responseRelayWork?<div className="vision-mesh-guide-target" role="status">
          <strong>{t("mesh.relay.responseReady")}</strong>
          <button type="button" className="primary compact-button"
            disabled={relayBusy} onClick={()=>void sendRelay(responseRelayWork,"response")}>
              {t("mesh.relay.sendResponse")}</button>
          <small>{t("mesh.recipient.notConnected")}</small>
        </div>:null}
        {relayReceipt?<p role="status">{t("mesh.relay.delivered")} {t("mesh.recipient.notConnected")}</p>:null}
        {relayProof?<div className="vision-mesh-guide-target vision-mesh-sas-approval">
          <strong>{t("mesh.relay.sas")}</strong>
          <code className="vision-mesh-sas-approval-code" aria-label={t("mesh.relay.sas")}>
            {relayProof.comparisonCode}
          </code>
          <small>{t("mesh.relay.compare")}</small>
          {selectedDevice&&selectedDevice.fingerprint===relayProof.fingerprint?
            <small>{t("mesh.relay.target")}: {selectedDevice.personaName||selectedDevice.displayName}</small>:
            <p role="alert" className="vision-mesh-warning">{t("mesh.relay.selectVerifiedPeer")}</p>}
          <label className="vision-mesh-field">{t("mesh.v3.confirmCode")}
            <input value={confirmedCode} maxLength={14} autoComplete="off"
              placeholder="AB12-34CD-EF09"
              onChange={e=>setConfirmedCode(e.target.value.toUpperCase())}/>
          </label>
          <button type="button" className="primary compact-button"
            disabled={!relayApprovalEligible}
            onClick={()=>void approvePeer()}>
              {t("mesh.v3.confirmButton")}
          </button>
          <small>{t("mesh.relay.localOnly")}</small>
          {approvalError?<p role="alert" className="vision-mesh-error">
            {t("mesh.v3.error")}</p>:null}
        </div>:null}
        {relayError?<p role="alert" className="vision-mesh-error">{t("mesh.relay.failed")}</p>:null}
      </section>:null}
    </section>
    </div>:null}
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
        <strong>{t("mesh.issuer.title")}</strong>
        <span>{issuerSnapshot?
          t(issuerSnapshot.compiledIssuer==="katoos_shared_qa"?"mesh.issuer.shared":
            issuerSnapshot.compiledIssuer==="katosync_legacy"?"mesh.issuer.legacy":"mesh.issuer.unknown"):
          t("mesh.issuer.olderBuild")}</span>
        {issuerSnapshot?.compiledIssuer==="katoos_shared_qa"?<details className="vision-mesh-reauth">
          <summary>{t("mesh.shared.title")}</summary>
          <p>{t("mesh.shared.description")}</p>
          <p role="status">{sharedError?t("mesh.shared.error"):
            sharedPreflight?.membership==="active"?t("mesh.shared.active"):
            sharedPreflight?.membership==="not_member"?t("mesh.shared.notMember"):
            t("mesh.shared.unchecked")}</p>
          <button type="button" className="ghost compact-button"
            onClick={()=>void checkSharedKatoos()} disabled={sharedBusy}>
            <RefreshCcw size={14} className={sharedBusy?"spin":""}/>
            {t("mesh.shared.check")}
          </button>
          <small>{t("mesh.shared.noTrust")}</small>
        </details>:null}
        <small>{t("mesh.issuer.separateLogin")}</small>
        <details className="vision-mesh-reauth">
          <summary>{t("mesh.preview.title")}</summary>
          <p>{t("mesh.preview.description")}</p>
          <p role="status">{!previewStatus?t("mesh.preview.oldBuild"):
            !previewStatus.configured?t("mesh.preview.notConfigured"):
            previewStatus.sessionVerified?t("mesh.preview.verified"):
            t("mesh.preview.notLoggedIn")}</p>
          {previewStatus?.sessionVerified&&previewStatus.accountEmail?
            <small>{previewStatus.accountEmail}</small>:null}
          {previewStatus?.configured?<form onSubmit={e=>{
            e.preventDefault();void previewAuthAction("login");
          }}>
            <label className="vision-mesh-field">{t("mesh.reauth.email")}
              <input type="email" autoComplete="username" value={previewEmail}
                onChange={e=>setPreviewEmail(e.target.value)} required/>
            </label>
            <label className="vision-mesh-field">{t("mesh.reauth.password")}
              <input type="password" autoComplete="current-password" value={previewPassword}
                onChange={e=>setPreviewPassword(e.target.value)} required/>
            </label>
            <button type="submit" className="secondary"
              disabled={previewBusy||!previewEmail.trim()||!previewPassword}>
              {t("mesh.preview.login")}
            </button>
          </form>:null}
          {previewStatus?.configured?<div className="vision-mesh-compact-actions">
            <button type="button" className="ghost compact-button" disabled={previewBusy}
              onClick={()=>void previewAuthAction("verify")}>{t("mesh.preview.verify")}</button>
            <button type="button" className="ghost compact-button" disabled={previewBusy}
              onClick={()=>void previewAuthAction("logout")}>{t("mesh.preview.logout")}</button>
          </div>:null}
          {previewError?<p role="alert" className="vision-mesh-error">
            {t("mesh.preview.error")}</p>:null}
          <small>{t("mesh.preview.noTrust")}</small>
        </details>
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
    <details className="vision-mesh-pairing">
      <summary>{t("mesh.v1.heading")}</summary>
      <p>{t("mesh.quick.description")}</p>
      <div className="vision-mesh-quick-panel" aria-label={t("mesh.quick.heading")}>
        <strong>{t("mesh.quick.heading")}</strong>
        <button type="button" className="ghost compact-button"
          onClick={()=>void prepareAndInvite()} disabled={pairingBusy||!snapshot}>
          {t("mesh.quick.connect")}</button>
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
