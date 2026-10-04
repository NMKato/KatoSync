// Created by NMKato Solutions

export const HANDOFF_PACKET_SCHEMA_VERSION = "1.0" as const;

export type HandoffTruthLevel = "observed" | "verified" | "canonical";
export type HandoffPacketStatus = "fresh" | "stale" | "rejected";

export interface HandoffEvidenceRef {
  id: string;
  kind: "git" | "ci" | "runtime" | "memory" | "human" | "test" | "other";
  truthLevel: HandoffTruthLevel;
  ref: string;
  verifiedAt?: string | null;
}

export interface HandoffLease {
  laneId: string;
  owner: string;
  worktreeId: string;
  expiresAt?: string | null;
}

export interface HandoffGitState {
  branch: string;
  headSha: string;
  workspaceId: string;
  deviceId?: string | null;
  dirtyFiles: string[];
  ownedFiles: string[];
}

export interface HandoffTaskIdentity {
  taskId: string;
  title: string;
  issue?: string | null;
  pullRequest?: string | null;
}

export interface HandoffPacket {
  schemaVersion: typeof HANDOFF_PACKET_SCHEMA_VERSION;
  packetId: string;
  projectId: string;
  projectName: string;
  task: HandoffTaskIdentity;
  goal: string;
  acceptanceCriteria: string[];
  phase: string;
  lastVerifiedAction: string;
  blocker?: string | null;
  failoverReason?: string | null;
  nextAction: string;
  guardrails: string[];
  git: HandoffGitState;
  lease: HandoffLease;
  memoryRefs: string[];
  evidence: HandoffEvidenceRef[];
  createdAt: string;
  expiresAt: string;
}

export interface HandoffPacketInput
  extends Omit<
    HandoffPacket,
    | "schemaVersion"
    | "acceptanceCriteria"
    | "guardrails"
    | "memoryRefs"
    | "evidence"
    | "git"
  > {
  acceptanceCriteria?: string[];
  guardrails?: string[];
  memoryRefs?: string[];
  evidence?: HandoffEvidenceRef[];
  git: Omit<HandoffGitState, "dirtyFiles" | "ownedFiles"> & {
    dirtyFiles?: string[];
    ownedFiles?: string[];
  };
}

export interface HandoffLiveState {
  branch: string;
  headSha: string;
  workspaceId: string;
  laneId: string;
  leaseOwner: string;
  worktreeId: string;
}

export interface HandoffValidation {
  status: HandoffPacketStatus;
  reasons: string[];
}

function compactUnique(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function required(value: string, field: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`Handoff Packet: ${field} fehlt.`);
  return clean;
}

export function buildHandoffPacket(input: HandoffPacketInput): HandoffPacket {
  const packet: HandoffPacket = {
    ...input,
    schemaVersion: HANDOFF_PACKET_SCHEMA_VERSION,
    packetId: required(input.packetId, "packetId"),
    projectId: required(input.projectId, "projectId"),
    projectName: required(input.projectName, "projectName"),
    task: {
      ...input.task,
      taskId: required(input.task.taskId, "task.taskId"),
      title: required(input.task.title, "task.title")
    },
    goal: required(input.goal, "goal"),
    acceptanceCriteria: compactUnique(input.acceptanceCriteria),
    phase: required(input.phase, "phase"),
    lastVerifiedAction: required(input.lastVerifiedAction, "lastVerifiedAction"),
    nextAction: required(input.nextAction, "nextAction"),
    guardrails: compactUnique(input.guardrails),
    git: {
      ...input.git,
      branch: required(input.git.branch, "git.branch"),
      headSha: required(input.git.headSha, "git.headSha"),
      workspaceId: required(input.git.workspaceId, "git.workspaceId"),
      dirtyFiles: compactUnique(input.git.dirtyFiles),
      ownedFiles: compactUnique(input.git.ownedFiles)
    },
    lease: {
      ...input.lease,
      laneId: required(input.lease.laneId, "lease.laneId"),
      owner: required(input.lease.owner, "lease.owner"),
      worktreeId: required(input.lease.worktreeId, "lease.worktreeId")
    },
    memoryRefs: compactUnique(input.memoryRefs),
    evidence: [...(input.evidence ?? [])],
    createdAt: required(input.createdAt, "createdAt"),
    expiresAt: required(input.expiresAt, "expiresAt")
  };

  if (Number.isNaN(Date.parse(packet.createdAt)) || Number.isNaN(Date.parse(packet.expiresAt))) {
    throw new Error("Handoff Packet: createdAt/expiresAt müssen ISO-Zeitstempel sein.");
  }
  if (Date.parse(packet.expiresAt) <= Date.parse(packet.createdAt)) {
    throw new Error("Handoff Packet: expiresAt muss nach createdAt liegen.");
  }
  return packet;
}

export function validateHandoffPacket(
  packet: HandoffPacket,
  live: HandoffLiveState,
  now = new Date()
): HandoffValidation {
  const reasons: string[] = [];

  if (packet.schemaVersion !== HANDOFF_PACKET_SCHEMA_VERSION) reasons.push("schema_mismatch");
  if (packet.git.workspaceId !== live.workspaceId) reasons.push("workspace_mismatch");
  if (packet.git.branch !== live.branch) reasons.push("branch_mismatch");
  if (packet.git.headSha !== live.headSha) reasons.push("head_mismatch");
  if (packet.lease.laneId !== live.laneId) reasons.push("lane_mismatch");
  if (packet.lease.owner !== live.leaseOwner) reasons.push("lease_owner_mismatch");
  if (packet.lease.worktreeId !== live.worktreeId) reasons.push("worktree_mismatch");

  const leaseExpiry = packet.lease.expiresAt ? Date.parse(packet.lease.expiresAt) : null;
  if (leaseExpiry !== null && leaseExpiry <= now.getTime()) reasons.push("lease_expired");

  const packetExpiry = Date.parse(packet.expiresAt);
  if (packetExpiry <= now.getTime()) reasons.push("packet_expired");

  const rejectedReasons = new Set([
    "schema_mismatch",
    "workspace_mismatch",
    "branch_mismatch",
    "head_mismatch",
    "lane_mismatch",
    "lease_owner_mismatch",
    "worktree_mismatch",
    "lease_expired"
  ]);

  if (reasons.some((reason) => rejectedReasons.has(reason))) {
    return { status: "rejected", reasons };
  }
  if (reasons.length) return { status: "stale", reasons };
  return { status: "fresh", reasons: [] };
}

export function buildTakeoverPrompt(packet: HandoffPacket): string {
  const acceptance = packet.acceptanceCriteria.length
    ? packet.acceptanceCriteria.map((item) => `- ${item}`).join("\n")
    : "- Keine zusätzlichen Kriterien im Paket.";

  const memory = packet.memoryRefs.length
    ? packet.memoryRefs.map((item) => `- ${item}`).join("\n")
    : "- Keine zusätzlichen Memory-Referenzen.";

  const guardrails = packet.guardrails.length
    ? packet.guardrails.map((item) => `- ${item}`).join("\n")
    : "- Bestehende Projekt-/Repository-Guardrails gelten.";

  return [
    "# KatoSync Zero-Orientation Handoff",
    "",
    "Dieses Paket wurde aus verifizierter Projektwahrheit erzeugt. Validiere Branch, HEAD und Lease vor dem ersten Write.",
    "Wenn die Validierung frisch ist, fahre mit der exakten nächsten Aktion fort. Führe KEINEN vollständigen Repository-Rescan durch, solange keine Evidenz fehlt oder widersprüchlich ist.",
    "",
    `Packet: ${packet.packetId}`,
    `Projekt: ${packet.projectName} (${packet.projectId})`,
    `Task: ${packet.task.title} [${packet.task.taskId}]`,
    `Phase: ${packet.phase}`,
    `Branch: ${packet.git.branch}`,
    `HEAD: ${packet.git.headSha}`,
    `Workspace: ${packet.git.workspaceId}`,
    `Lane/Owner: ${packet.lease.laneId} / ${packet.lease.owner}`,
    "",
    "## Ziel",
    packet.goal,
    "",
    "## Letzte verifizierte Aktion",
    packet.lastVerifiedAction,
    "",
    "## Nächste Aktion",
    packet.nextAction,
    "",
    "## Akzeptanz",
    acceptance,
    "",
    "## Guardrails",
    guardrails,
    "",
    "## Memory-Referenzen",
    memory,
    "",
    packet.blocker ? `Blocker: ${packet.blocker}` : "Blocker: keiner",
    packet.failoverReason ? `Handoff-Grund: ${packet.failoverReason}` : "Handoff-Grund: planmäßig"
  ].join("\n");
}

export function recoveryReadiness(
  validation: HandoffValidation,
  hasCanonicalMemory: boolean,
  hasVerifiedEvidence: boolean
): "green" | "yellow" | "red" {
  if (validation.status === "rejected") return "red";
  if (validation.status === "stale" || !hasCanonicalMemory || !hasVerifiedEvidence) return "yellow";
  return "green";
}
