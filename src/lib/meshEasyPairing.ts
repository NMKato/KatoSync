// Created by NMKato Solutions
// Stage4S: guarded visible pairing choreography; no auto-trust or remote access.
export type EasyMeshRole="sender"|"recipient";
export type EasyMeshStage="idle"|"waiting"|"verifying"|"compare"|"approved"|"expired"|"error";
export type EasyMeshSession={
  role:EasyMeshRole;
  requestId:string;
  localDeviceId:string;
  peerDeviceId:string;
  peerFingerprint:string;
  expiresAtMs:number;
};
export type EasyRelayMessage={
  requestId:string;
  senderDeviceId:string;
  recipientDeviceId:string;
  kind:"challenge"|"response";
  expiresAt:number;
};
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT=/^[0-9A-F]{2}(?:-[0-9A-F]{2}){15}$/;
const MAX_LIFETIME_MS=10*60*1000;
export function validEasyMeshSession(session:EasyMeshSession|null,nowMs:number):boolean{
  if(!session||!Number.isFinite(nowMs))return false;
  return ID.test(session.requestId)&&ID.test(session.localDeviceId)&&
    ID.test(session.peerDeviceId)&&session.localDeviceId!==session.peerDeviceId&&
    FINGERPRINT.test(session.peerFingerprint)&&
    Number.isFinite(session.expiresAtMs)&&session.expiresAtMs>nowMs&&
    session.expiresAtMs<=nowMs+MAX_LIFETIME_MS;
}
export function matchEasyRelayMessage(session:EasyMeshSession|null,
  item:EasyRelayMessage,nowMs:number):boolean{
  if(!validEasyMeshSession(session,nowMs))return false;
  if(!ID.test(item.requestId)||!ID.test(item.senderDeviceId)||!ID.test(item.recipientDeviceId))return false;
  if(item.requestId!==session!.requestId||item.senderDeviceId!==session!.peerDeviceId||
     item.recipientDeviceId!==session!.localDeviceId)return false;
  const expected=session!.role==="sender"?"challenge":"response";
  if(item.kind!==expected)return false;
  const msgExpiry=item.expiresAt*1000;
  return Number.isSafeInteger(item.expiresAt)&&msgExpiry>nowMs&&
    msgExpiry<=session!.expiresAtMs&&msgExpiry<=nowMs+MAX_LIFETIME_MS;
}
export function canQuickApproveSameCode(input:{
  proof:{comparisonCode:string;fingerprint:string;paired:false;peerCount:0;transportReady:false}|null;
  peer:{fingerprint:string;membershipState:"discovered"|"pending"|"trusted"|"revoked"}|null;
  session:EasyMeshSession|null;
  explicitOwnerConfirmation:boolean;busy:boolean;nowMs:number
}):boolean {
  const {proof,peer,session,explicitOwnerConfirmation,busy,nowMs}=input;
  if(!explicitOwnerConfirmation||busy||!proof||!peer||!session||!validEasyMeshSession(session,nowMs))return false;
  if(proof.paired!==false||proof.peerCount!==0||proof.transportReady!==false)return false;
  if(!/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(proof.comparisonCode))return false;
  if(proof.fingerprint!==peer.fingerprint||peer.fingerprint!==session.peerFingerprint)return false;
  return peer.membershipState==="discovered"||peer.membershipState==="pending";
}
