// Created by NMKato Solutions
// Stage4X UI-only guard: selecting a locally approved peer for QA must
// NEVER send a fresh invite or create a new trust relationship.
type Peer = {fingerprint:string;membershipState:string};
type Pin = {fingerprint:string;status:string};
export function canSelectLocallyApprovedPeerForQa(args:{
  enabled:boolean;
  peer:Peer|null;
  approvedPeers:ReadonlyArray<Pin>|null;
  ownFingerprint:string|null;
}):boolean {
  const {enabled,peer,approvedPeers,ownFingerprint}=args;
  if(!enabled||!peer||!approvedPeers||
     peer.membershipState==="revoked"||
     !/^[0-9A-F]{2}(-[0-9A-F]{2}){15}$/.test(peer.fingerprint)||
     !ownFingerprint||peer.fingerprint===ownFingerprint)return false;
  return approvedPeers.some(pin=>
    pin.status==="locally_approved"&&pin.fingerprint===peer.fingerprint);
}
