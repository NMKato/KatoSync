// NMKato Solutions — stage 3.5: introductions between verified Mesh colleagues.
// This is a PURE planner. Only the signed, mutually trusted transport may send the payload.
// Smalltalk never includes conversation history, prompts, project paths or credentials.

export interface VerifiedMeshColleague {
  deviceId: string;
  ownerUserId: string;
  displayName: string;
  agentName: string;
  fingerprint: string;
  membershipState:"discovered"|"pending"|"trusted"|"revoked";
  locallyPinned: boolean;
  peerProofVerified: boolean;
  secureTransportReady: boolean;
}
export type MeshWelcomeStage = "not_signed_in"|"no_colleagues"|"discovered"|"approval_required"|"ready_for_hello";
export interface MeshWelcomeRecommendation {
  stage:MeshWelcomeStage;
  peerName:string|null;
  peerDeviceId:string|null;
  canAutoSendHello:boolean;
  canReceiveBriefing:boolean;
}
export interface SharedWorkSummary {
  projectLabel:string;
  completedJobs:number;
  currentRole:"planning"|"coding"|"review"|"support";
  shareApproved:boolean;
}
export interface MeshWelcomeMessage {
  protocol:"katosync-mesh-welcome-v35";
  senderDeviceId:string;
  recipientDeviceId:string;
  greeting:string;
  sharedWork:readonly {project:string;completedJobs:number;role:string}[];
  expiresAtMs:number;
  pairingGrant:false;
  remoteJobGrant:false;
}

const ID=/^[a-zA-Z0-9_-]{8,80}$/;
const LABEL=/^[\p{L}\p{N} ._()&+-]{1,64}$/u;
const MAX_SUMMARIES=3;
const MAX_COUNTS=9999;
function safeName(value:string):string {
  // A greeting is plain text; never interpret it as a command or markup.
  const clean=value.replace(/[^\p{L}\p{N} ._+-]/gu,"").trim();
  return clean.slice(0,48)||"KAI";
}
export function selectMeshColleague(input:{
  accountVerified:boolean;
  ownerUserId:string;
  ownDeviceId:string;
  devices:readonly VerifiedMeshColleague[];
}):MeshWelcomeRecommendation {
  const base={peerName:null,peerDeviceId:null,canAutoSendHello:false,canReceiveBriefing:false};
  if(!input.accountVerified || !input.ownerUserId || !ID.test(input.ownDeviceId)){
    return {...base,stage:"not_signed_in"};
  }
  const peers=input.devices.filter(x=>x.deviceId!==input.ownDeviceId &&
      x.ownerUserId===input.ownerUserId && x.membershipState!=="revoked" && ID.test(x.deviceId))
    .sort((a,b)=>a.deviceId.localeCompare(b.deviceId));
  const colleague=peers[0];
  if(!colleague)return {...base,stage:"no_colleagues"};
  const pending={
    ...base,peerName:safeName(colleague.agentName||colleague.displayName),
    peerDeviceId:colleague.deviceId
  };
  if(colleague.membershipState==="discovered")return {...pending,stage:"discovered"};
  if(colleague.membershipState!=="trusted" ||
     !colleague.locallyPinned || !colleague.peerProofVerified ||
     !colleague.secureTransportReady) {
    return {...pending,stage:"approval_required"};
  }
  return {...pending,stage:"ready_for_hello",canAutoSendHello:true,canReceiveBriefing:true};
}
export function prepareMeshWelcome(input:{
  senderDeviceId:string;
  recipientDeviceId:string;
  agentName:string;
  peerAgentName:string;
  nowMs:number;
  peerWasMutuallyAuthorized:boolean;
  ownerScopeVerified:boolean;
  privateTransportReady:boolean;
  introductionAlreadyConfirmed:boolean;
  work:readonly SharedWorkSummary[];
}):MeshWelcomeMessage|null {
  if(!input.peerWasMutuallyAuthorized || !input.ownerScopeVerified ||
     !input.privateTransportReady || input.introductionAlreadyConfirmed ||
     !Number.isSafeInteger(input.nowMs) ||
     !ID.test(input.senderDeviceId)||!ID.test(input.recipientDeviceId) ||
     input.senderDeviceId===input.recipientDeviceId) return null;
  const sharedWork:MeshWelcomeMessage["sharedWork"][number][]=[];
  for(const row of input.work) {
    if(!row.shareApproved || !LABEL.test(row.projectLabel) ||
       !Number.isSafeInteger(row.completedJobs)||row.completedJobs<0||
       row.completedJobs>MAX_COUNTS || !["planning","coding","review","support"].includes(row.currentRole))continue;
    if(sharedWork.length===MAX_SUMMARIES)break;
    sharedWork.push({project:row.projectLabel,completedJobs:row.completedJobs,role:row.currentRole});
  }
  return {
    protocol:"katosync-mesh-welcome-v35",
    senderDeviceId:input.senderDeviceId,
    recipientDeviceId:input.recipientDeviceId,
    greeting:`Hallo ${safeName(input.peerAgentName)}! Ich bin ${safeName(input.agentName)}. Willkommen im Team. Ich helfe dir beim Einstieg.`,
    sharedWork,
    expiresAtMs:input.nowMs+60_000,
    pairingGrant:false,
    remoteJobGrant:false
  };
}
