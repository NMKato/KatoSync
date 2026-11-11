// Created by NMKato Solutions — read-only owner-scoped local pairing presentation.
// A Keychain pin is NOT a live tunnel, not authorization to run remote work.
// Never infer pairing from a database roster, invite, session flag or agent name.
export type MeshPairingDisplay = "checking"|"not_paired"|"locally_paired";
type Pin = {fingerprint:string;status:"locally_approved";approvedAt:number;publicKey:string};
type Device = {fingerprint:string;ownerUserId:string;membershipState:string};
export function deriveLocalPairingStatus(input:{
  pins:readonly Pin[]|null;
  devices:readonly Device[]|null;
  ownFingerprint:string|null;
  transport:string|null;
  remoteReadOnlyDispatch:boolean|null;
  crossDeviceWrites:boolean|null;
}):MeshPairingDisplay {
  // The native readiness contract explicitly forbids pretending to be online.
  if(input.transport!=="not_connected" || input.remoteReadOnlyDispatch!==false ||
     input.crossDeviceWrites!==false) return "checking";
  if(input.pins===null || input.devices===null || !input.ownFingerprint) return "checking";
  const own=input.devices.find(d=>d.fingerprint===input.ownFingerprint &&
    d.membershipState!=="revoked");
  if(!own || !own.ownerUserId) return "checking";
  const ownsPeer=input.pins.some(pin=>
    pin.status==="locally_approved" && pin.approvedAt>0 &&
    /^[0-9A-F]{2}(-[0-9A-F]{2}){15}$/.test(pin.fingerprint) &&
    input.devices!.some(peer=>peer.fingerprint===pin.fingerprint &&
      peer.fingerprint!==own.fingerprint &&
      peer.ownerUserId===own.ownerUserId &&
      peer.membershipState==="discovered"));
  return ownsPeer ? "locally_paired":"not_paired";
}
