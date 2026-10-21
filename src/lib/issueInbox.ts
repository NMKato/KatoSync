// Created by NMKato Solutions
// Secure Beta Check: deterministische, nur lesende GitHub-Issue-Inbox.
// Der untrusted Issue-Text darf niemals zu einem Agent-Auftrag oder Shell-Befehl werden.
import type { RegistryProject } from "../types.ts";
import { normalizeRemote, redactSecrets } from "./projectExclusions.ts";

export type IssuePriority = "P0" | "P1" | "P2" | "P3";
export type IssueReviewReason = "human_approval_required" | "project_commit_unverified";

export interface GithubIssueBatch {
  remote: string;
  // Externes JSON (gh/GitHub API) gilt bis zur Validation als untrusted.
  issues: unknown;
}

export interface IssueInboxEntry {
  key: string;
  projectId: string;
  projectName: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  gitHead: string | null;
  priority: IssuePriority;
  securityRelated: boolean;
  reviewReason: IssueReviewReason;
  requiresHumanApproval: true;
  autoFixAllowed: false;
}

export interface IssueInbox {
  checkedAt: string;
  entries: IssueInboxEntry[];
  unmatchedRepoCount: number;
  invalidIssueCount: number;
  ambiguousRepoCount: number;
  // Keine gescannten GitHub-Issues == unbekannter Status, nicht "alles gruen".
  evidence: "github_read_only_snapshot";
  assessment: "requires_review" | "no_issues_observed";
}

function githubRepo(remote: string | null | undefined): string | null {
  const normalized = normalizeRemote(remote);
  if (!normalized) return null;
  const match = /^github\.com\/([a-z0-9-]+)\/([a-z0-9_.-]+)$/.exec(normalized);
  if (!match || match[2] === "." || match[2] === "..") return null;
  return `${match[1]}/${match[2]}`;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function labelsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 100)
    .map((item: unknown) => {
      const label = typeof item === "string" ? item : item && typeof item === "object" ? (item as Record<string, unknown>).name : null;
      return text(label)?.toLowerCase() ?? "";
    })
    .filter(Boolean);
}

function priorityOf(labels: string[]): IssuePriority {
  const categories = new Set(labels.map((l) => l.replace(/^priority[:/\s-]*/, "").trim()));
  for (const priority of ["P0", "P1", "P2", "P3"] as const) {
    if (categories.has(priority.toLowerCase())) return priority;
  }
  return "P2"; // Unbekannte Issues erfordern Review, Priorität ist vorläufig.
}

function parseIssue(raw: unknown, repo: string, project: RegistryProject): IssueInboxEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const number = value.number;
  const title = text(value.title);
  const url = text(value.url);
  const updatedAt = text(value.updatedAt);
  const state = text(value.state)?.toLowerCase();
  if (!Number.isSafeInteger(number) || (number as number) < 1 || !title || !url || !updatedAt || state !== "open") return null;

  // URL ist ein exakter Identitätsnachweis für Repo + Issue-ID, keine beliebige Verlinkung.
  const exact = new RegExp(`^https://github\\.com/${repo.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}/issues/${number}$`, "i");
  if (!exact.test(url) || !Number.isFinite(Date.parse(updatedAt))) return null;

  const labels = labelsOf(value.labels);
  const securityRelated = labels.some((l) => ["security", "vulnerability", "auth", "rls", "privacy", "incident"].includes(l));
  const gitHead = project.scan?.headSha && /^[0-9a-f]{7,40}$/i.test(project.scan.headSha)
    ? project.scan.headSha
    : null;

  return {
    key: `${repo.toLowerCase()}#${number}`,
    projectId: project.id,
    projectName: project.name,
    repository: repo,
    number: number as number,
    // Titles may contain secrets, misleading commands and Markdown. Store plain redacted text only.
    title: redactSecrets(title).slice(0, 300),
    url: `https://github.com/${repo}/issues/${number}`,
    updatedAt,
    gitHead,
    priority: priorityOf(labels),
    securityRelated,
    reviewReason: gitHead ? "human_approval_required" : "project_commit_unverified",
    requiresHumanApproval: true,
    autoFixAllowed: false
  };
}

const PRIORITY_ORDER: Record<IssuePriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Local classification only: no GitHub API writes, no code execution and no agent dispatch. */
export function buildIssueInbox(projects: RegistryProject[], batches: GithubIssueBatch[], checkedAt: string): IssueInbox {
  const byRemote = new Map<string, RegistryProject[]>();
  for (const project of projects) {
    const repo = githubRepo(project.remote);
    if (!repo) continue;
    byRemote.set(repo, [...(byRemote.get(repo) ?? []), project]);
  }
  const byKey = new Map<string, IssueInboxEntry>();
  let unmatchedRepoCount = 0;
  let invalidIssueCount = 0;
  let ambiguousRepoCount = 0;
  for (const batch of batches) {
    const repo = githubRepo(batch.remote);
    if (!repo) {
      unmatchedRepoCount++;
      continue;
    }
    const targets = byRemote.get(repo);
    if (!targets?.length) {
      unmatchedRepoCount++;
      continue;
    }
    if (targets.length !== 1) {
      ambiguousRepoCount++;
      continue;
    }
    if (!Array.isArray(batch.issues)) {
      invalidIssueCount++;
      continue;
    }
    for (const raw of batch.issues.slice(0, 200)) {
      const issue = parseIssue(raw, repo, targets[0]);
      if (!issue) {
        invalidIssueCount++;
        continue;
      }
      const prev = byKey.get(issue.key);
      if (!prev || Date.parse(issue.updatedAt) > Date.parse(prev.updatedAt)) byKey.set(issue.key, issue);
    }
  }
  const entries = [...byKey.values()].sort((a, b) =>
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    || Number(b.securityRelated) - Number(a.securityRelated)
    || a.repository.localeCompare(b.repository)
    || a.number - b.number
  );
  return {
    checkedAt,
    entries,
    unmatchedRepoCount,
    invalidIssueCount,
    ambiguousRepoCount,
    evidence: "github_read_only_snapshot",
    assessment: entries.length || unmatchedRepoCount || invalidIssueCount || ambiguousRepoCount || !batches.length
      ? "requires_review"
      : "no_issues_observed"
  };
}
