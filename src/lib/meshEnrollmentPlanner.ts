// Created by NMKato Solutions
/**
 * VIEW-ONLY enrollment planner for the future KatoSync Auto-Mesh UI.
 * IMPORTANT: This pure function neither authenticates accounts nor grants device trust.
 * The future native/backend enrollment gate MUST independently verify passkey/WebAuthn
 * assertions, signed device challenges, account scope and persisted owner policy.
 * UI-derived booleans and device nicknames are NOT authorization evidence.
 */

export type MeshEnrollmentMode = "manual"|"auto";
export type MeshEnrollmentOutcome =
  "blocked"|"manual_approval"|"auto_reconnect_candidate"|"auto_enroll_candidate";
export type MeshEnrollmentReason =
  "issuer_unverified"|"wrong_account"|"device_revoked"|"no_device_proof"|
  "invalid_policy"|"owner_action_required"|"device_limit"|
  "fresh_passkey_required"|"device_binding_required"|"already_trusted"|"auto_mode_eligible";

export interface MeshOwnerPolicyView {
  /** Server-issued opaque stable scope, not the user's email or local app label. */
  accountScope:string;
  mode:MeshEnrollmentMode;
  /** A verified prior opt-in, not inferred from account login. */
  verifiedOwnerOptIn:boolean;
  /** Signed account-level policy is active until this epoch time. */
  expiresAtMs:number;
  /** Product quota, upper-bounded by the native peer list. */
  maxDevices:number;
}

export interface MeshCandidateView {
  /** Public, stable cryptographic device identifier; display name is never proof. */
  deviceId:string;
  accountScope:string;
  issuerVerified:boolean;
  /** Result of an independently verified per-device signed challenge. */
  deviceProofVerified:boolean;
  /** Retrieved from the verified account's revocation/pin store, NOT from the device. */
  revoked:boolean;
  locallyTrusted:boolean;
  /** A fresh phishing-resistant reauth completed on the joining new device. */
  freshPasskeyVerified:boolean;
  /** Passkey assertion / signed enrollment grant is bound to this device public key. */
  passkeyBoundToDevice:boolean;
}

export interface MeshEnrollmentPlan {
  outcome:MeshEnrollmentOutcome;
  reason:MeshEnrollmentReason;
  /** This UI function NEVER grants file, remote command, or transport permissions. */
  authorizedCapabilities:readonly [];
  /** The native/server grant must independently verify cryptographic evidence. */
  nativeApprovalRequired:true;
}

const MAX_NATIVE_PEERS=10;
const view=(outcome:MeshEnrollmentOutcome, reason:MeshEnrollmentReason):MeshEnrollmentPlan=>({
  outcome,reason,authorizedCapabilities:[],nativeApprovalRequired:true
});

/** Returns ONLY a suggested UX state. Do not use this for backend authorization. */
export function planMeshEnrollment(
  policy:MeshOwnerPolicyView,
  candidate:MeshCandidateView,
  enrolledDeviceCount:number,
  nowMs:number
):MeshEnrollmentPlan{
  if(!candidate.issuerVerified)return view("blocked","issuer_unverified");
  if(!candidate.accountScope||candidate.accountScope!==policy.accountScope)
    return view("blocked","wrong_account");
  if(candidate.revoked)return view("blocked","device_revoked");
  if(!candidate.deviceId||!candidate.deviceProofVerified)
    return view("blocked","no_device_proof");
  if(!Number.isFinite(nowMs)||!Number.isFinite(policy.expiresAtMs)||
     !Number.isInteger(enrolledDeviceCount)||enrolledDeviceCount<0||
     !Number.isInteger(policy.maxDevices)||policy.maxDevices<1||
     policy.maxDevices>MAX_NATIVE_PEERS)
    return view("blocked","invalid_policy");
  if(!policy.verifiedOwnerOptIn||policy.mode!=="auto"||policy.expiresAtMs<=nowMs)
    return view("manual_approval","owner_action_required");
  // A trusted device can silently reconnect after signed identity proof.
  if(candidate.locallyTrusted)return view("auto_reconnect_candidate","already_trusted");
  if(enrolledDeviceCount>=policy.maxDevices)
    return view("blocked","device_limit");
  // A new device can be enrolled WITHOUT a second incoming accept pop-up only
  // after the owner pre-authorized Auto-Mesh AND strong device-bound reauthentication.
  if(!candidate.freshPasskeyVerified)
    return view("manual_approval","fresh_passkey_required");
  if(!candidate.passkeyBoundToDevice)
    return view("manual_approval","device_binding_required");
  return view("auto_enroll_candidate","auto_mode_eligible");
}
