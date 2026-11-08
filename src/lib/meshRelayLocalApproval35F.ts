// NMKato Solutions — UI eligibility only. Native Keychain enforces all trust.
// Never infer automatic trust from the account, cloud invite or signed relay.
export interface RelaySasProof {
  comparisonCode:string;
  fingerprint:string;
  paired:boolean;
  peerCount:number;
  transportReady:boolean;
}
export interface RelayApprovalTarget {
  fingerprint:string;
  membershipState:"discovered"|"pending"|"trusted"|"revoked";
}
const CODE=/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;
const FINGERPRINT=/^[0-9A-F]{2}(?:-[0-9A-F]{2}){15}$/;
const normalized=(value:string)=>value.toUpperCase().replace(/-/g,"");
export function canConfirmRelayPeerLocally(input:{
  proof:RelaySasProof|null;
  selectedPeer:RelayApprovalTarget|null;
  codeFromOtherDevice:string;
  busy:boolean;
}):boolean{
  const {proof,selectedPeer,codeFromOtherDevice,busy}=input;
  if(busy||!proof||!selectedPeer||proof.paired||proof.transportReady||proof.peerCount!==0)return false;
  if(selectedPeer.membershipState!=="discovered"&&selectedPeer.membershipState!=="pending")return false;
  if(!FINGERPRINT.test(proof.fingerprint)||!FINGERPRINT.test(selectedPeer.fingerprint))return false;
  if(normalized(proof.fingerprint)!==normalized(selectedPeer.fingerprint))return false;
  if(!CODE.test(proof.comparisonCode)||!CODE.test(codeFromOtherDevice))return false;
  return codeFromOtherDevice===proof.comparisonCode;
}
