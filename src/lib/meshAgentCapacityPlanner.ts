// NMKato Solutions – Stage 4E: deterministischer Mesh-Agenten-Kapazitätsplaner.
// Reiner Plan: KEIN Netzwerkversand, keine automatische Vertrauensfreigabe und kein Start von Jobs.
// Ein registriertes Gerät = maximal ein autonomer Agent mit einem aktiven Schreib-Job.
// Berechtigungs- und TLS-Nachweise sind harte Voraussetzungen, keine UI-Labels.
export const MESH_FREE_AGENT_LIMIT=0;
export const MESH_PRO_AGENT_LIMIT=10;
export const MESH_TRIAL_DAYS=14;
export type MeshProductPlan="free"|"pro"|"trial";
export type MeshAgentCapability="local_llm"|"codex"|"claude"|"api";

export interface MeshAgentEntitlement {
  plan:MeshProductPlan;
  verifiedByServer:boolean;
  expiresAt?:string|null;
}
export interface MeshAgentNode {
  deviceId:string;
  agentName:string;
  ownerUserId:string;
  registered:boolean;
  trusted:boolean;
  sessionVerified:boolean;
  mutualTlsReady:boolean;
  remoteJobsAuthorized:boolean;
  online:boolean;
  heartbeatAt:string;
  lastAssignedAt?:string|null;
  capabilities:readonly MeshAgentCapability[];
}
export interface MeshAgentJob {
  taskId:string;
  repoKey:string;
  capability:MeshAgentCapability;
  approved:boolean;
  resourceScopeApproved:boolean;
  writerLeaseRequired:boolean;
}
export interface MeshAgentLease {
  taskId:string;
  deviceId:string;
  repoKey:string;
  active:boolean;
}
export interface MeshAgentAssignment {
  taskId:string;
  deviceId:string;
  agentName:string;
  capability:MeshAgentCapability;
}
export type MeshAgentWaitReason="plan_unavailable"|"approval_required"|"no_agent_capacity"|"repository_busy"|"duplicate_task";
export interface MeshAgentCapacityPlan {
  allowedDevices:0|10;
  registeredDevices:number;
  readyAgents:number;
  runningAgents:number;
  parallelCapacity:number;
  assignments:readonly MeshAgentAssignment[];
  waiting:readonly {taskId:string;reason:MeshAgentWaitReason}[];
}

const ALLOWED=new Set<MeshAgentCapability>(["local_llm","codex","claude","api"]);
const MAX_HEARTBEAT_AGE_MS=60_000;
function verifiedTime(value:string):number|null {
  const parsed=Date.parse(value);
  return Number.isFinite(parsed)?parsed:null;
}
function planLimit(entitlement:MeshAgentEntitlement,nowMs:number):0|10 {
  if(!entitlement.verifiedByServer)return 0;
  if(entitlement.plan==="free")return 0;
  if(entitlement.plan!=="trial"&&entitlement.plan!=="pro")return 0;
  if(entitlement.plan==="trial") {
    const expiry=entitlement.expiresAt?verifiedTime(entitlement.expiresAt):null;
    if(expiry===null||expiry<=nowMs)return 0;
  }
  if(entitlement.plan==="pro"&&entitlement.expiresAt) {
    const expiry=verifiedTime(entitlement.expiresAt);
    if(expiry===null||expiry<=nowMs)return 0;
  }
  return MESH_PRO_AGENT_LIMIT;
}
function eligible(node:MeshAgentNode,ownerUserId:string,nowMs:number):boolean {
  const heartbeat=verifiedTime(node.heartbeatAt);
  return node.ownerUserId===ownerUserId&&node.registered&&node.trusted&&
    node.sessionVerified&&node.mutualTlsReady&&node.remoteJobsAuthorized&&node.online&&
    typeof node.deviceId==="string"&&node.deviceId.length>=8&&
    typeof node.agentName==="string"&&node.agentName.trim().length>0&&node.agentName.length<=80&&
    Array.isArray(node.capabilities)&&node.capabilities.length>0&&
    node.capabilities.every(capability=>ALLOWED.has(capability))&&
    heartbeat!==null&&heartbeat<=nowMs&&nowMs-heartbeat<=MAX_HEARTBEAT_AGE_MS;
}
/** Nur freigegebene, nicht doppelte Geräte können ein Remote-Slot bekommen.
 * Leases – auch verwaiste – werden nicht automatisch übernommen. Kein Credential-Failover. */
export function planMeshAgentCapacity(input:{
  entitlement:MeshAgentEntitlement;
  ownerUserId:string;
  nowMs:number;
  nodes:readonly MeshAgentNode[];
  leases:readonly MeshAgentLease[];
  jobs:readonly MeshAgentJob[];
}):MeshAgentCapacityPlan {
  const {entitlement,ownerUserId,nowMs,nodes,leases,jobs}=input;
  const allowedDevices=planLimit(entitlement,nowMs);
  const registeredDevices=nodes.filter(n=>n.ownerUserId===ownerUserId&&n.registered).length;
  const validOwner=typeof ownerUserId==="string"&&ownerUserId.length>=8&&Number.isFinite(nowMs);
  const limitsOk=validOwner&&registeredDevices<=allowedDevices&&nodes.length<=MESH_PRO_AGENT_LIMIT;
  const duplicates=new Set<string>();
  const ids=new Set<string>();
  for(const node of nodes) {
    if(ids.has(node.deviceId))duplicates.add(node.deviceId);
    ids.add(node.deviceId);
  }
  const authorized=limitsOk?nodes.filter(node=>!duplicates.has(node.deviceId)&&eligible(node,ownerUserId,nowMs)):[];
  const runningIds=new Set(leases.filter(lease=>lease.active).map(lease=>lease.deviceId));
  const busyRepos=new Set(leases.filter(lease=>lease.active).map(lease=>lease.repoKey));
  const alreadyLeased=new Set(leases.filter(lease=>lease.active).map(lease=>lease.taskId));
  // Fairness: zuerst der am laengsten ungenutzte Agent; kein dauerhaft bevorzugter M2.
  const freeAgents=authorized.filter(node=>!runningIds.has(node.deviceId))
    .sort((a,b)=>{
      const stamp=(node:MeshAgentNode)=>{
        const value=node.lastAssignedAt?verifiedTime(node.lastAssignedAt):null;
        // Fehlendes/ungueltiges Datum bedeutet kein zuverlaessiger Lastnachweis.
        return value===null?Number.NEGATIVE_INFINITY:value;
      };
      return stamp(a)-stamp(b)||a.deviceId.localeCompare(b.deviceId);
    });
  const initialCapacity=freeAgents.length;
  const runningAgents=authorized.filter(node=>runningIds.has(node.deviceId)).length;
  const assignments:MeshAgentAssignment[]=[];
  const waiting:{taskId:string;reason:MeshAgentWaitReason}[]=[];
  const seenTasks=new Set<string>();
  for(const job of jobs) {
    if(seenTasks.has(job.taskId)||alreadyLeased.has(job.taskId)) {
      waiting.push({taskId:job.taskId,reason:"duplicate_task"});
      continue;
    }
    seenTasks.add(job.taskId);
    if(!limitsOk||allowedDevices===0) {
      waiting.push({taskId:job.taskId,reason:"plan_unavailable"});
      continue;
    }
    if(!job.approved||!job.resourceScopeApproved||!job.writerLeaseRequired||
       !ALLOWED.has(job.capability)||!job.repoKey.trim()||!job.taskId.trim()) {
      waiting.push({taskId:job.taskId,reason:"approval_required"});
      continue;
    }
    if(busyRepos.has(job.repoKey)) {
      waiting.push({taskId:job.taskId,reason:"repository_busy"});
      continue;
    }
    const index=freeAgents.findIndex(node=>node.capabilities.includes(job.capability));
    if(index<0) {
      waiting.push({taskId:job.taskId,reason:"no_agent_capacity"});
      continue;
    }
    const node=freeAgents.splice(index,1)[0];
    assignments.push({taskId:job.taskId,deviceId:node.deviceId,agentName:node.agentName,capability:job.capability});
    busyRepos.add(job.repoKey);
  }
  return {
    allowedDevices,registeredDevices,readyAgents:authorized.length,runningAgents,
    parallelCapacity:initialCapacity,assignments,waiting
  };
}
