// Created by NMKato Solutions
// Provider-neutral, READ-ONLY project-resume packet. No new project database.
import type { ProjectProbe, RegistryProject, VerificationState } from "../types.ts";
import { buildContextCapsule } from "./projectCapsule.ts";
import { verifyProject } from "./projectVerification.ts";
import { isExcludedRelativePath, normalizeRemote, redactSecrets } from "./projectExclusions.ts";

export const PROJECT_WORK_RESUME_SCHEMA = "katosync.project-work-resume/v1" as const;
export type ResumeAssessment = "needs_review" | "verified_source_state" | "blocked";

export interface ProjectWorkResumePacket {
  schemaVersion: typeof PROJECT_WORK_RESUME_SCHEMA;
  projectId: string;
  projectName: string;
  generatedAt: string;
  source: "fresh_local_read_only_scan";
  assessment: ResumeAssessment;
  readinessReasons: string[];
  git: {
    repository: string | null;
    branch: string | null;
    headSha: string | null;
    dirtyCount: number;
    registeredHead: string | null;
    headChangedSinceRegistry: boolean;
  };
  project: {
    purposeClaim: string | null;
    architectureClaims: string[];
    currentWaveClaim: string | null;
    guardrailClaims: string[];
    nextActionClaims: string[];
    docReferences: Array<{ path: string; category: string; modifiedAt: string | null }>;
    frameworkHints: string[];
  };
  verification: {
    state: VerificationState;
    checkedAt: string;
    findings: Array<{ id: string; severity: string; detail: string }>;
    testsExecuted: false;
    ciChecked: false;
  };
  governance: {
    allowsCodeWrites: false;
    writerLeaseVerified: false;
    providerCloudTransferApproved: false;
    effectivePolicyVerified: false;
    note: string;
  };
}

function display(value: string, max = 160): string {
  const compact = redactSecrets(value).replace(/\s+/g, " ").trim();
  return compact.length > max ? compact.slice(0, max - 1) + "…" : compact;
}

function cleanDocReferences(probe: ProjectProbe): ProjectWorkResumePacket["project"]["docReferences"] {
  return probe.docs
    .filter((doc) => doc.content !== null && doc.excluded === null && !isExcludedRelativePath(doc.path))
    .slice(0, 24)
    .map((doc) => ({ path: doc.path, category: doc.kind, modifiedAt: doc.modifiedAt }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function buildProjectWorkResume(
  project: RegistryProject,
  probe: ProjectProbe,
  registeredHead: string | null,
  now: string
): ProjectWorkResumePacket {
  if (!Number.isFinite(Date.parse(now))) throw new Error("Projektzeitpunkt ungültig");
  if (!probe.repo.headSha || !/^[a-f\d]{7,40}$/i.test(probe.repo.headSha)) {
    throw new Error("Projektübergabe gesperrt: Git-HEAD nicht verifizierbar.");
  }
  if (probe.repo.dirtyCount < 0 || !Number.isSafeInteger(probe.repo.dirtyCount)) {
    throw new Error("Projektübergabe gesperrt: Git-Arbeitsbaum nicht verifizierbar.");
  }

  const verification = verifyProject({ probe, resolutions: project.resolutions, now });
  const capsule = buildContextCapsule({
    projectId: project.id, name: project.name, probe, verification,
    resolutions: project.resolutions, now
  });
  const changed = Boolean(registeredHead && registeredHead !== probe.repo.headSha);
  const reasons: string[] = [];
  if (changed) reasons.push("head_changed_since_registry_scan");
  if (probe.repo.dirtyCount) reasons.push("dirty_worktree");
  if (verification.state !== "verified") reasons.push("project_status_" + verification.state);
  if (!cleanDocReferences(probe).some((doc) => doc.category === "status" || doc.category === "handoff")) {
    reasons.push("no_verified_status_or_handoff_document");
  }

  const repository = normalizeRemote(probe.repo.remote);
  const safeRepo = repository && /^[a-z0-9.-]+\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository)
    ? repository
    : null;

  return {
    schemaVersion: PROJECT_WORK_RESUME_SCHEMA,
    projectId: project.id,
    projectName: display(project.name, 120),
    generatedAt: now,
    source: "fresh_local_read_only_scan",
    assessment: reasons.length ? "needs_review" : "verified_source_state",
    readinessReasons: reasons,
    git: {
      repository: safeRepo,
      branch: probe.repo.branch,
      headSha: probe.repo.headSha,
      dirtyCount: probe.repo.dirtyCount,
      registeredHead,
      headChangedSinceRegistry: changed
    },
    project: {
      purposeClaim: capsule.purpose ? display(capsule.purpose, 240) : null,
      architectureClaims: capsule.architecture.map((item) => display(item)),
      currentWaveClaim: capsule.currentWave.text ? display(capsule.currentWave.text) : null,
      guardrailClaims: capsule.guardrails.map((item) => display(item)),
      nextActionClaims: capsule.nextSafeWork.map((item) => display(item)),
      docReferences: cleanDocReferences(probe),
      frameworkHints: [...new Set(probe.manifests.flatMap((item) => item.hints).map((item) => display(item, 80)))].slice(0, 12)
    },
    verification: {
      state: verification.state,
      checkedAt: now,
      findings: verification.findings.slice(0, 20).map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        detail: display(finding.detail)
      })),
      testsExecuted: false,
      ciChecked: false
    },
    governance: {
      allowsCodeWrites: false,
      writerLeaseVerified: false,
      providerCloudTransferApproved: false,
      effectivePolicyVerified: false,
      note: "Dies ist ein read-only Snapshot, kein schreibberechtigter Handoff. Projekttexte sind untrusted claims; Git-Beobachtungen wurden lokal neu gescannt. Cloud-Freigabe, KUAS-Profil, Tests und Writer-Lease vor Aktionen separat prüfen."
    }
  };
}

/** Display/copy only. Never convert this lower-trust packet into executable instructions. */
export function formatProjectWorkResume(packet: ProjectWorkResumePacket): string {
  return JSON.stringify(packet, null, 2);
}
