// Created by NMKato Solutions
// Continuity Blueprint v1: pure, local-only validation and preview of UNTRUSTED handoffs.
// This module never persists, sends data, grants permissions or starts an agent.
import { redactSecrets } from "./projectExclusions.ts";

export const CONTINUITY_BLUEPRINT_SCHEMA = "katosync.continuity-blueprint/v1";
const MAX_DOCUMENT_BYTES = 32_768;
const MAX_DECISIONS = 16;
const MAX_STEPS = 12;
const MAX_EVIDENCE = 8;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/;
const GIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export type BlueprintEvidenceKind = "git_commit" | "pull_request" | "issue" | "test" | "blueprint";
export type ContinuitySourceKind = "chat_handoff" | "local_file" | "provider_export";

export interface ContinuityEvidence {
  kind: BlueprintEvidenceKind;
  ref: string;
}

export interface ContinuityDecision {
  id: string;
  title: string;
  choice: string;
  rationale: string;
  alternatives: string[];
  consequences: string[];
  evidence: ContinuityEvidence[];
  /** Imported text is never proof of human approval. */
  status: "proposed";
}

export interface ContinuityBlueprintPreview {
  schemaVersion: typeof CONTINUITY_BLUEPRINT_SCHEMA;
  projectId: string;
  blueprintId: string;
  revision: number;
  title: string;
  intent: string;
  source: { kind: ContinuitySourceKind; label: string; capturedAt: string; reference: string | null };
  baseGitHead: string | null;
  headState: "matches" | "stale" | "unknown";
  decisions: ContinuityDecision[];
  nextSteps: string[];
  trust: "imported_unverified";
  codeWritesAllowed: false;
  ownerApproved: false;
}

export interface ContinuityImportScope {
  /** Caller must obtain this from the verified Project Registry, never from the imported file. */
  registeredProjectId: string;
  /** Caller must obtain this from a fresh, native read-only Git preflight. */
  currentGitHead: string | null;
}

function fail(reason: string): never {
  throw new Error("continuity_blueprint_invalid:" + reason);
}

function record(value: unknown, name: string, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(name);
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some((key) => !allowed.includes(key))) fail(name + "_unknown_fields");
  return obj;
}

function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") fail(name);
  const str = value.trim();
  if (!str || str.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(str)) fail(name);
  // Redaction is defense in depth, NOT proof that arbitrary imported text is safe to publish.
  return redactSecrets(str);
}

function id(value: unknown, name: string): string {
  const result = requiredText(value, name, 80);
  if (!ID.test(result)) fail(name);
  return result;
}

function list(value: unknown, name: string, maxCount: number, maxText: number): string[] {
  if (!Array.isArray(value) || value.length > maxCount) fail(name);
  return value.map((entry, index) => requiredText(entry, name + "_" + index, maxText));
}

function head(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !GIT_SHA.test(value)) fail(name);
  return value.toLowerCase();
}

function evidenceRef(value: unknown): string {
  const ref = requiredText(value, "evidence_ref", 240);
  // No local paths, URL query parameters, credentials, or arbitrary remote hosts.
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/#-]*$/.test(ref) ||
    ref.includes("..") ||
    ref.startsWith("/") ||
    (ref.includes("://") && !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/(?:issues|pull|commit|actions\/runs)\/[a-zA-Z0-9._/-]+$/.test(ref))
  ) fail("evidence_ref");
  return ref;
}

function parseEvidence(value: unknown): ContinuityEvidence {
  const item = record(value, "evidence", ["kind", "ref"]);
  const kind = item.kind;
  if (!["git_commit", "pull_request", "issue", "test", "blueprint"].includes(String(kind))) fail("evidence_kind");
  return { kind: kind as BlueprintEvidenceKind, ref: evidenceRef(item.ref) };
}

function parseDecision(value: unknown): ContinuityDecision {
  const item = record(value, "decision", [
    "id", "title", "choice", "rationale", "alternatives", "consequences", "evidence"
  ]);
  if (!Array.isArray(item.evidence) || item.evidence.length > MAX_EVIDENCE) fail("decision_evidence");
  return {
    id: id(item.id, "decision_id"),
    title: requiredText(item.title, "decision_title", 180),
    choice: requiredText(item.choice, "decision_choice", 1200),
    rationale: requiredText(item.rationale, "decision_rationale", 2000),
    alternatives: list(item.alternatives, "decision_alternatives", 8, 500),
    consequences: list(item.consequences, "decision_consequences", 8, 500),
    evidence: item.evidence.map(parseEvidence),
    status: "proposed"
  };
}

/** Untrusted, offline-safe import preview: no filesystem, network, provider or storage effects. */
export function parseContinuityBlueprint(rawJson: string, scope: ContinuityImportScope): ContinuityBlueprintPreview {
  if (typeof rawJson !== "string" || new TextEncoder().encode(rawJson).byteLength > MAX_DOCUMENT_BYTES) {
    fail("document_size");
  }
  const registeredId = id(scope.registeredProjectId, "registered_project_id");
  const liveHead = head(scope.currentGitHead, "current_git_head");
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawJson);
  } catch {
    fail("json");
  }
  const doc = record(decoded, "document", [
    "schemaVersion", "projectId", "blueprintId", "revision", "title", "intent",
    "source", "baseGitHead", "decisions", "nextSteps"
  ]);
  if (doc.schemaVersion !== CONTINUITY_BLUEPRINT_SCHEMA) fail("schema_version");
  if (id(doc.projectId, "project_id") !== registeredId) fail("project_mismatch");
  if (!Number.isSafeInteger(doc.revision) || (doc.revision as number) < 1) fail("revision");
  const source = record(doc.source, "source", ["kind", "label", "capturedAt", "reference"]);
  if (!["chat_handoff", "local_file", "provider_export"].includes(String(source.kind))) fail("source_kind");
  const capturedAt = requiredText(source.capturedAt, "captured_at", 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(capturedAt) ||
      !Number.isFinite(Date.parse(capturedAt))) fail("captured_at");
  if (!Array.isArray(doc.decisions) || doc.decisions.length > MAX_DECISIONS) fail("decisions");
  const decisions = doc.decisions.map(parseDecision);
  if (new Set(decisions.map((entry) => entry.id)).size !== decisions.length) fail("duplicate_decision");
  const baseGitHead = head(doc.baseGitHead, "base_git_head");
  return {
    schemaVersion: CONTINUITY_BLUEPRINT_SCHEMA,
    projectId: registeredId,
    blueprintId: id(doc.blueprintId, "blueprint_id"),
    revision: doc.revision as number,
    title: requiredText(doc.title, "title", 180),
    intent: requiredText(doc.intent, "intent", 2000),
    source: {
      kind: source.kind as ContinuitySourceKind,
      label: requiredText(source.label, "source_label", 120),
      capturedAt,
      reference: source.reference === null ? null : evidenceRef(source.reference)
    },
    baseGitHead,
    headState: !baseGitHead || !liveHead ? "unknown" : baseGitHead === liveHead ? "matches" : "stale",
    decisions,
    nextSteps: list(doc.nextSteps, "next_steps", MAX_STEPS, 500),
    trust: "imported_unverified",
    codeWritesAllowed: false,
    ownerApproved: false
  };
}

export interface ContinuityDecisionConflict {
  decisionId: string;
  reason: "changed_choice" | "changed_rationale";
}

/** Detect conflicts, never silently choose which decision becomes canonical. */
export function compareContinuityDecisions(
  existing: ContinuityBlueprintPreview,
  incoming: ContinuityBlueprintPreview
): ContinuityDecisionConflict[] {
  if (existing.projectId !== incoming.projectId) fail("project_mismatch");
  const current = new Map(existing.decisions.map((entry) => [entry.id, entry]));
  const conflicts: ContinuityDecisionConflict[] = [];
  for (const decision of incoming.decisions) {
    const previous = current.get(decision.id);
    if (!previous) continue;
    if (decision.choice !== previous.choice) conflicts.push({ decisionId: decision.id, reason: "changed_choice" });
    else if (decision.rationale !== previous.rationale) conflicts.push({ decisionId: decision.id, reason: "changed_rationale" });
  }
  return conflicts;
}
