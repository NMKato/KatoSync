// Created by NMKato Solutions
// Stage4K source-level provider-branch policy, no filesystem writes or grants.
export type ExecutionSource =
  | "local" | "codex" | "claude" | "openai_api"
  | "anthropic_api" | "remote_orchestrator";

export interface AgentBranchIdentity {
  projectId: string;
  source: ExecutionSource;
  providerId: string;
  agentId: string;
  jobId: string;
}
export interface BranchEvidence {
  actualBranch: string | null;
  actualProjectId: string | null;
  actualSource: ExecutionSource | null;
  observedHead: string | null;
  expectedHead: string | null;
  gitAndOwnerVerified: boolean;
  activeWriterLease: boolean;
  approvedJob: boolean;
  signedHandoff: boolean;
}
export interface BranchAdmission {
  eligible: boolean;
  expectedBranch: string | null;
  reason: "safe" | "invalid_identity" | "unverified_branch" | "cross_project" |
    "foreign_provider" | "stale_head" | "writer_busy" | "missing_approval" |
    "handoff_unverified";
  createsBranch: false;
  grantsWriterLease: false;
  automaticMerge: false;
}
const KNOWN_SOURCES: ReadonlySet<string> = new Set([
  "local", "codex", "claude", "openai_api", "anthropic_api", "remote_orchestrator"
]);
const TOKEN = /^[a-z][a-z0-9-]{0,35}$/;
const JOB = /^[a-z0-9][a-z0-9-]{5,47}$/;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function isIdentity(x: AgentBranchIdentity): boolean {
  return TOKEN.test(x.projectId) && TOKEN.test(x.providerId) && TOKEN.test(x.agentId)
    && JOB.test(x.jobId) && KNOWN_SOURCES.has(x.source);
}
// Isolated by project/provider/agent/job. No actual branch creation.
export function expectedAgentBranch(identity: AgentBranchIdentity): string | null {
  if (!isIdentity(identity)) return null;
  return "agents/" + identity.projectId + "/" + identity.source + "/" + identity.providerId + "/" +
    identity.agentId + "/" + identity.jobId;
}
export function authorizeAgentBranch(
  identity: AgentBranchIdentity,
  evidence: BranchEvidence
): BranchAdmission {
  const expectedBranch = expectedAgentBranch(identity);
  const deny = (reason: BranchAdmission["reason"]): BranchAdmission =>
    ({eligible: false, expectedBranch, reason, createsBranch: false,
      grantsWriterLease: false, automaticMerge: false});
  if (!expectedBranch) return deny("invalid_identity");
  if (evidence.actualProjectId !== identity.projectId) return deny("cross_project");
  if (evidence.actualSource !== identity.source) return deny("foreign_provider");
  if (evidence.actualBranch !== expectedBranch || !evidence.gitAndOwnerVerified) {
    return deny("unverified_branch");
  }
  if (!evidence.expectedHead || !SHA.test(evidence.expectedHead) ||
      evidence.observedHead !== evidence.expectedHead) return deny("stale_head");
  if (evidence.activeWriterLease) return deny("writer_busy");
  if (!evidence.approvedJob) return deny("missing_approval");
  if (!evidence.signedHandoff) return deny("handoff_unverified");
  // Advisory proof only; never infer a native lease or Git write permission.
  return { eligible: true, expectedBranch, reason: "safe",
    createsBranch: false, grantsWriterLease: false, automaticMerge: false };
}
export interface SharedProjectContext {
  projectId: string;
  requestedBy: ExecutionSource;
  permittedProjects: readonly string[];
  canonicalSnapshotVerified: boolean;
  canonicalRevision: string | null;
}
// Canonical per-project memory, read-only for providers; cross-project global index
// may contain pointers/IDs only, not unapproved full project memory.
export function authorizeSharedProjectRead(context: SharedProjectContext) {
  const valid = TOKEN.test(context.projectId)
    && KNOWN_SOURCES.has(context.requestedBy)
    && context.permittedProjects.includes(context.projectId)
    && context.canonicalSnapshotVerified
    && typeof context.canonicalRevision === "string"
    && SHA.test(context.canonicalRevision);
  return {
    allowed: valid,
    canonicalOnly: true,
    readOnly: true,
    mayWriteProjectStatusFlow: false,
    mayPromoteMemory: false,
    crossProjectContentsExposed: false,
    writerLeaseDelegated: false
  } as const;
}
