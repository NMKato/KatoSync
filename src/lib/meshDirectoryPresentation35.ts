// NMKato Solutions: account records are cryptographic APP identities, not computers.
// Never infer a physical computer, peer trust or "online" from a database timestamp.
export interface MeshRegistrationCard {
  deviceId:string;
  fingerprint:string;
  lastSeenAt:string|null;
  membershipState:"discovered"|"pending"|"trusted"|"revoked";
}
export interface MeshRegistrationGroups<T extends MeshRegistrationCard> {
  own:T|null;
  recentlyReported:T[];
  olderEntries:T[];
  totalIdentities:number;
  registeredPeers:number;
}

const FINGERPRINT=/^[0-9A-F]{32}$/;
const MAX_CLOCK_SKEW_MS=5*60_000;
const RECENT_WINDOW_MS=2*60*60_000;
function canonicalFingerprint(raw:string|null|undefined):string|null {
  if(typeof raw!=="string")return null;
  const normalized=raw.replace(/-/g,"").toUpperCase();
  return FINGERPRINT.test(normalized)?normalized:null;
}
/**
 * Cross-app deterministic display name derived from public Ed25519 fingerprint.
 * Matches Rust mesh_agent_bootstrap::agent_name. UI only, never authorization.
 */
export function meshRegistrationAgentName(
  fingerprint:string, platform:"macos"|"windows"|"linux"
):string|null {
  const normalized=canonicalFingerprint(fingerprint);
  if(!normalized)return null;
  const names=["Nova","Atlas","Orion","Lyra","Astra","Mira","Vega","Solis",
    "Echo","Nexus","Ari","Lumen","Tera","Nika","Sirius","Pax"];
  const family=platform==="macos"?"Mac":platform==="windows"?"Win":"Linux";
  const index=Number.parseInt(normalized.slice(30,32),16)%names.length;
  return "KAI "+names[index]+" "+family+"-"+normalized.slice(24,28);
}
function latestFirst(a:MeshRegistrationCard,b:MeshRegistrationCard):number{
  const da=Date.parse(a.lastSeenAt??"")||0;
  const db=Date.parse(b.lastSeenAt??"")||0;
  return db-da || a.deviceId.localeCompare(b.deviceId);
}
/**
 * Groups only a read-only UI list. Even two records on the same Mac MUST
 * remain separate security principals until owner-verifiable machine linking.
 */
export function presentMeshRegistrations<T extends MeshRegistrationCard>(input:{
  devices:readonly T[];
  localFingerprint:string|null|undefined;
  nowMs:number;
}):MeshRegistrationGroups<T> {
  const {devices,nowMs}=input;
  const ownFingerprint=canonicalFingerprint(input.localFingerprint);
  const recentlyReported:T[]=[];
  const olderEntries:T[]=[];
  let own:T|null=null;
  const seenIds=new Set<string>();
  for(const device of devices){
    // Ignore duplicate API rows: duplicate UI rows are never new principals.
    if(!device.deviceId||seenIds.has(device.deviceId))continue;
    seenIds.add(device.deviceId);
    if(ownFingerprint&&canonicalFingerprint(device.fingerprint)===ownFingerprint){
      own ??= device;
      continue;
    }
    const last=Date.parse(device.lastSeenAt??"");
    const recently=Number.isFinite(last)&&Number.isFinite(nowMs) &&
      last<=nowMs+MAX_CLOCK_SKEW_MS && last>=nowMs-RECENT_WINDOW_MS &&
      device.membershipState!=="revoked";
    (recently?recentlyReported:olderEntries).push(device);
  }
  recentlyReported.sort(latestFirst);
  olderEntries.sort(latestFirst);
  return {
    own,recentlyReported,olderEntries,
    totalIdentities:seenIds.size,
    registeredPeers:recentlyReported.length+olderEntries.length
  };
}
