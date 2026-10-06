// Created by NMKato Solutions
// User-facing presentation of canonical Agent-Sync jobs. Pure functions: canonical job IDs, task names,
// files and branches are never changed here; this layer only removes presentation noise (leading
// date/job IDs, repeated project slug, lane suffixes, long numeric suffixes) and never adds text,
// paths or secrets that were not already part of the input.
import type { AgentJob } from "../types";

export interface JobActivityPresentation {
  /** Concise user-facing activity title. */
  title: string;
  /** Raw canonical task + job ID for tooltip/debugging. */
  tooltip: string;
  /** true = title differs from the canonical task. */
  humanized: boolean;
}

const BRAND_CASING: Record<string, string> = { katosync: "KatoSync" };
// Lane/provider suffixes in queue slugs: the owner is shown separately, so they are noise in the title.
const LANE_SUFFIX = new Set(["claude", "codex", "openai", "gpt", "local", "remote", "rdc", "orchestrator"]);
const LEADING_NOISE = new Set(["job", "task"]);
const SLUG = /^[\p{L}\p{N}._-]+$/u;

/** Dates, times, numeric suffixes and hash-like IDs (hex with at least one digit). */
function isIdToken(token: string): boolean {
  if (/^\d{4,}$/.test(token)) return true;
  return token.length >= 8 && /\d/.test(token) && /^[0-9a-f]+$/i.test(token);
}

/** A whole " · "-segment that is only an ID (e.g. Local Control "command · jobId"). */
function isIdSegment(segment: string): boolean {
  if (/\s/.test(segment)) return false;
  return /\d{4,}/.test(segment) || isIdToken(segment);
}

function wordCase(word: string): string {
  return BRAND_CASING[word.toLowerCase()] ?? word;
}

function capitalize(text: string): string {
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : text;
}

function projectLabel(tokens: string[]): string {
  return tokens.map((token) => BRAND_CASING[token.toLowerCase()] ?? capitalize(token)).join(" ");
}

function slugTokens(value: string): string[] {
  return value.split(/[-_]+/).filter(Boolean);
}

function humanizeSlug(slug: string, projectId: string | null | undefined): string | null {
  let tokens = slugTokens(slug);
  while (tokens.length > 1 && (isIdToken(tokens[0]) || LEADING_NOISE.has(tokens[0].toLowerCase()))) tokens = tokens.slice(1);
  while (tokens.length > 1 && (isIdToken(tokens[tokens.length - 1]) || LANE_SUFFIX.has(tokens[tokens.length - 1].toLowerCase()))) {
    tokens = tokens.slice(0, -1);
  }
  if (!tokens.length || (tokens.length === 1 && isIdToken(tokens[0]))) return null;

  // Repeated project slug -> short project prefix ("KatoSync · Vision").
  const lower = tokens.map((token) => token.toLowerCase());
  const projectTokens = projectId && SLUG.test(projectId) ? slugTokens(projectId.toLowerCase()) : [];
  let prefixLength = 0;
  if (projectTokens.length && projectTokens.every((token, index) => lower[index] === token)) prefixLength = projectTokens.length;
  else if (BRAND_CASING[lower[0]]) prefixLength = 1;

  const project = prefixLength ? projectLabel(tokens.slice(0, prefixLength)) : null;
  const rest = tokens.slice(prefixLength).map(wordCase).join(" ");
  if (project && rest) return `${project} · ${capitalize(rest)}`;
  return project ?? capitalize(rest);
}

/**
 * Concise activity title from canonical task text. Natural text stays unchanged (except a trailing
 * pure-ID segment); technical slugs lose only presentation noise. Never returns an empty string.
 */
export function jobActivityTitle(task: string, projectId?: string | null): string {
  const raw = task.trim();
  if (!raw) return task;

  if (/\s/.test(raw)) {
    const segments = raw.split(" · ");
    while (segments.length > 1 && isIdSegment(segments[segments.length - 1].trim())) segments.pop();
    return segments.join(" · ");
  }

  if (!SLUG.test(raw) || !/[-_]/.test(raw)) return raw;
  return humanizeSlug(raw, projectId) ?? raw;
}

export function jobActivityPresentation(job: Pick<AgentJob, "id" | "externalId" | "task" | "projectId">): JobActivityPresentation {
  const title = jobActivityTitle(job.task, job.projectId);
  const canonicalId = job.externalId ?? job.id;
  const tooltip = [...new Set([job.task, canonicalId].filter(Boolean))].join(" · ");
  return { title, tooltip, humanized: title !== job.task };
}
