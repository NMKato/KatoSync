/**
 * RC68 – owner-workstation Mesh dispatch proposal (source-only).
 * This is NOT an executor, authorization authority, or device grant.
 * All data must come from a trusted device/owner registry and signed agent
 * presence; the actual executor MUST reauthorize independently per job.
 */
export type WorkspaceMode =
  "read-only" | "project-writer" | "owner-workstation" | "computer-use";
export type AgentCapability =
  "status.read" | "repo.read" | "files.read" | "files.write" |
  "terminal.run" | "computer.view" | "computer.control";
export type WorkloadClass = "routine" | "heavy";
export type WorkloadLane = "device-local-gemma" | "provider-escalation";

export interface WorkstationJob {
  id: string;
  ownerId: string;
  projectId: string;
  mode: WorkspaceMode;
  requiredCapability: AgentCapability;
  workload: WorkloadClass;
  requestedDeviceId?: string;
  minFreeMemoryGiB: number;
  cloudEscalationPermitted: boolean;
}

export interface WorkstationHost {
  deviceId: string;
  ownerId: string;
  connected: boolean;
  signedPresenceFresh: boolean;
  localAgentRunning: boolean;
  modelId: "gemma-4-e4b" | null;
  modelVerifiedReady: boolean;
  freeMemoryGiB: number;
  cpuLoadFraction: number;
  // A lease is required before the planner can nominate a write-capable host.
  projectWriterLeaseVerified: boolean;
  desktopPrivacyPermissionsVerified: boolean;
  // Only for scheduling; this is not a substitute for macOS/Windows consent.
  localUserSessionActive: boolean;
}

export interface WorkstationDelegation {
  ownerId: string;
  deviceId: string;
  projectId: string;
  mode: WorkspaceMode;
  approvedCapabilities: AgentCapability[];
  ownerApprovalVerified: boolean;
  stepUpVerified: boolean;
  revokedAt: string | null;
  expiresAt: string;
}

export interface ProviderAvailability {
  // An official user-controlled CLI / provider integration, or an API
  // with its own separate billing and egress approval. No token borrowing.
  approvedBackend: "none" | "official-cli" | "api";
  credentialsAvailableOnHost: boolean;
  separateCloudEgressApproved: boolean;
  remainingBudget: number;
}

export interface WorkstationPlan {
  status: "candidate" | "blocked";
  deviceId: string | null;
  lane: WorkloadLane | null;
  reason: string;
  // A planner must never be treated as an OS permission or execution permit.
  executionAuthorized: false;
  requiresFreshServerAuthorization: true;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{3,127}$/;
const MODES: ReadonlySet<string> = new Set([
  "read-only","project-writer","owner-workstation","computer-use"
]);
const CAPABILITIES: ReadonlySet<string> = new Set([
  "status.read","repo.read","files.read","files.write","terminal.run",
  "computer.view","computer.control"
]);
const WRITE_CAPABILITIES: ReadonlySet<string> = new Set([
  "files.write","terminal.run","computer.control"
]);
const modeAllows = (mode: WorkspaceMode, capability: AgentCapability): boolean => {
  if (mode === "read-only") return ["status.read","repo.read","files.read"].includes(capability);
  if (mode === "project-writer") return !["computer.view","computer.control"].includes(capability);
  if (mode === "owner-workstation") return capability !== "computer.control" && capability !== "computer.view";
  return true;
};
const blocked = (reason: string): WorkstationPlan => ({
  status:"blocked",deviceId:null,lane:null,reason,
  executionAuthorized:false,requiresFreshServerAuthorization:true
});
const uuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const validDeadline = (value: unknown, nowMs:number): boolean =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value)) && Date.parse(value)>nowMs &&
  Date.parse(value)-nowMs<=24*60*60*1000;

export function planOwnerWorkstationJob({
  job,hosts,delegations,provider,nowMs=Date.now()
}:{
  job: WorkstationJob;
  hosts: WorkstationHost[];
  delegations: WorkstationDelegation[];
  provider: ProviderAvailability;
  nowMs?: number;
}): WorkstationPlan {
  if (!Number.isFinite(nowMs)||!uuid(job?.ownerId)||!SAFE_ID.test(job?.id??"") ||
      !SAFE_ID.test(job?.projectId??"")||!MODES.has(job?.mode) ||
      !CAPABILITIES.has(job?.requiredCapability)||
      !["routine","heavy"].includes(job?.workload) ||
      !Number.isFinite(job?.minFreeMemoryGiB)||job.minFreeMemoryGiB<0 ||
      job.minFreeMemoryGiB>4096 ||
      (job.requestedDeviceId!==undefined&&!uuid(job.requestedDeviceId))||
      typeof job.cloudEscalationPermitted!=="boolean" ||
      !Array.isArray(hosts)||hosts.length>100||
      !Array.isArray(delegations)||delegations.length>500)
    return blocked("INVALID_WORKLOAD_REQUEST");
  if (!modeAllows(job.mode,job.requiredCapability))
    return blocked("CAPABILITY_NOT_ALLOWED_IN_MODE");

  const trustedCandidates: Array<{
    host: WorkstationHost; grant: WorkstationDelegation
  }>=[];
  const seen=new Set<string>();
  for (const host of hosts) {
    if (!uuid(host?.deviceId)||!uuid(host?.ownerId)||
        !Number.isFinite(host?.freeMemoryGiB)||host.freeMemoryGiB<0||
        !Number.isFinite(host?.cpuLoadFraction)||host.cpuLoadFraction<0||
        host.cpuLoadFraction>1 ||seen.has(host.deviceId))
      return blocked("INVALID_DEVICE_INVENTORY");
    seen.add(host.deviceId);
    if (host.ownerId!==job.ownerId ||
        (job.requestedDeviceId && host.deviceId!==job.requestedDeviceId)||
        host.connected!==true||host.signedPresenceFresh!==true||
        host.localAgentRunning!==true||
        host.freeMemoryGiB<job.minFreeMemoryGiB ||
        host.cpuLoadFraction>0.9)continue;

    // A client-side grant is never sufficient. Caller provides only attested
    // records in the QA planner; runtime verifies signatures and revocation.
    const matches=delegations.filter(g=>
      g.ownerId===job.ownerId && g.deviceId===host.deviceId &&
      g.projectId===job.projectId && g.mode===job.mode);
    if(matches.length!==1)continue;
    const grant=matches[0];
    if(grant.ownerApprovalVerified!==true||grant.revokedAt!==null||
        !validDeadline(grant.expiresAt,nowMs)||
        !Array.isArray(grant.approvedCapabilities)||
        new Set(grant.approvedCapabilities).size!==grant.approvedCapabilities.length||
        !grant.approvedCapabilities.every(c=>CAPABILITIES.has(c))||
        !grant.approvedCapabilities.includes(job.requiredCapability))continue;

    const mutating=WRITE_CAPABILITIES.has(job.requiredCapability);
    if(mutating && host.projectWriterLeaseVerified!==true)continue;
    if((job.mode==="owner-workstation"||job.mode==="computer-use") &&
       grant.stepUpVerified!==true)continue;
    if(job.mode==="computer-use"&&(
       host.desktopPrivacyPermissionsVerified!==true ||
       host.localUserSessionActive!==true))continue;
    trustedCandidates.push({host,grant});
  }

  if(trustedCandidates.length===0)return blocked("NO_AUTHORIZED_READY_HOST");
  const preferred=[...trustedCandidates].sort((a,b)=>
    (b.host.freeMemoryGiB-a.host.freeMemoryGiB) ||
    (a.host.cpuLoadFraction-b.host.cpuLoadFraction)||
    a.host.deviceId.localeCompare(b.host.deviceId))[0].host;
  // Local inference is the default. A more powerful provider can be
  // suggested, but never auto-invoked by this planner.
  let lane: WorkloadLane|null =
    preferred.modelId==="gemma-4-e4b"&&preferred.modelVerifiedReady
      ? "device-local-gemma" : null;

  if (job.workload==="heavy"||lane===null) {
    if(job.cloudEscalationPermitted &&
      provider?.approvedBackend!=="none" &&
      ["official-cli","api"].includes(provider?.approvedBackend) &&
      provider?.credentialsAvailableOnHost===true &&
      provider?.separateCloudEgressApproved===true &&
      Number.isFinite(provider?.remainingBudget) &&
      provider.remainingBudget>0)
      lane="provider-escalation";
    else if(lane===null)return blocked("MODEL_UNAVAILABLE_AND_PROVIDER_NOT_APPROVED");
  }

  if(lane===null)return blocked("NO_COMPUTE_LANE");
  return {
    status:"candidate",deviceId:preferred.deviceId,lane,
    reason:"PLANNER_ONLY_PENDING_EXECUTOR_AUTHORIZATION",
    executionAuthorized:false,requiresFreshServerAuthorization:true
  };
}
