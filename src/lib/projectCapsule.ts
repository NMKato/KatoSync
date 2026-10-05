// Created by NMKato Solutions
// Context Capsule: kompakte, providerneutrale Projektzusammenfassung (RACK-Stil) aus dem READ-ONLY-Scan.
// Rein und deterministisch, mit festen Obergrenzen. Enthaelt nie Secrets, absolute Pfade oder Rohinhalte
// ganzer Dokumente – nur kurze, geschwaerzte Auszuege. Ersetzt den Context Pack nicht (siehe docs/PROJECT_REGISTRY.md).
import type { ContextCapsule, DocFact, MismatchResolution, ProjectProbe, ProjectVerification } from "../types";
import { redactSecrets } from "./projectExclusions.ts";
import { collectClaims, parseStatusClaims } from "./projectVerification.ts";

const MAX_PURPOSE = 240;
const MAX_ITEM = 160;
const MAX_ITEMS = 8;

const ARCH_PATTERNS: Array<[RegExp, string]> = [
  [/\bMVVM\b/i, "MVVM"],
  [/\brepository\b/i, "Repository"],
  [/\badapter\b/i, "Adapter"],
  [/\bclean architecture\b/i, "Clean Architecture"],
  [/\bevent[- ]driven\b/i, "Event-driven"],
  [/\bmonorepo\b/i, "Monorepo"],
  [/\btauri\b/i, "Tauri"],
  [/\breact\b/i, "React"],
  [/\bswiftui\b/i, "SwiftUI"],
  [/\bnext\.?js\b/i, "Next.js"],
  [/\bsupabase\b/i, "Supabase"],
  [/\bcloudflare\b/i, "Cloudflare"],
  [/\bvite\b/i, "Vite"],
  [/\bfastapi\b/i, "FastAPI"],
  [/\brust\b/i, "Rust"],
  [/\btypescript\b/i, "TypeScript"]
];

function clip(value: string, max = MAX_ITEM): string {
  const clean = redactSecrets(
    value
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[*_`#>]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function readable(docs: DocFact[], kinds: DocFact["kind"][]): DocFact[] {
  return docs
    .filter((doc) => kinds.includes(doc.kind) && doc.content !== null && doc.excluded === null)
    .sort((a, b) => a.path.localeCompare(b.path));
}

interface Section {
  heading: string;
  lines: string[];
}

function sections(content: string): Section[] {
  const result: Section[] = [];
  let current: Section | null = null;
  for (const line of content.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      current = { heading: heading[1], lines: [] };
      result.push(current);
    } else if (current) current.lines.push(line);
  }
  return result;
}

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/;

function bullets(lines: string[]): string[] {
  return lines.map((line) => BULLET.exec(line)?.[1] ?? "").filter(Boolean);
}

function pushUnique(target: string[], value: string, max: number) {
  if (value && target.length < max && !target.includes(value)) target.push(value);
}

function purposeOf(docs: DocFact[]): string {
  for (const doc of [...readable(docs, ["readme"]), ...readable(docs, ["agents"])]) {
    const paragraph = (doc.content ?? "")
      .split(/\r?\n\s*\r?\n/)
      .map((block) => block.trim())
      .find((block) => block && !block.startsWith("#") && !block.startsWith("![") && !block.startsWith("[![") && !block.startsWith("|") && !block.startsWith("```") && block.replace(/[^A-Za-zÄÖÜäöüß]/g, "").length > 20);
    if (paragraph) return clip(paragraph, MAX_PURPOSE);
  }
  return "";
}

function architectureOf(probe: ProjectProbe): string[] {
  const text = probe.docs
    .filter((doc) => doc.content !== null && doc.excluded === null)
    .map((doc) => doc.content)
    .join("\n");
  const found: string[] = [];
  for (const [pattern, label] of ARCH_PATTERNS) if (pattern.test(text)) pushUnique(found, label, MAX_ITEMS);
  for (const manifest of probe.manifests) for (const hint of manifest.hints) pushUnique(found, clip(hint, 40), MAX_ITEMS);
  return found.slice(0, MAX_ITEMS);
}

const RULE_HEADING = /(regel|guardrail|rule|sicherheit|security|policy|leitplanke|constraint|grenzen)/i;
const RULE_LINE = /\b(nie|niemals|never|nicht|must not|do not|don't|darf keine?|only|ausschließlich|ausschliesslich)\b/i;

function guardrailsOf(docs: DocFact[]): string[] {
  const rules: string[] = [];
  for (const doc of readable(docs, ["agents"])) {
    const parsed = sections(doc.content ?? "");
    for (const section of parsed.filter((entry) => RULE_HEADING.test(entry.heading))) {
      for (const item of bullets(section.lines)) pushUnique(rules, clip(item), MAX_ITEMS);
    }
    for (const section of parsed) for (const item of bullets(section.lines)) if (RULE_LINE.test(item)) pushUnique(rules, clip(item), MAX_ITEMS);
  }
  return rules;
}

const NEXT_HEADING = /(next safe steps?|nächste sichere schritte|naechste sichere schritte|nächster sicherer schritt|naechster sicherer schritt|next steps?|nächste schritte|naechste schritte|to-?do|offene punkte|open items)/i;

function freshness(doc: DocFact): number {
  const claims = parseStatusClaims(doc.content ?? "");
  const value = claims.updatedAt ?? doc.modifiedAt;
  if (!value) return 0;
  const parsed = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function nextWorkOf(docs: DocFact[]): string[] {
  const candidates = readable(docs, ["status", "handoff"]).sort(
    (a, b) => freshness(b) - freshness(a) || a.path.localeCompare(b.path)
  );
  // Der frischeste Handoff/Status mit expliziter Next-Work-Sektion gewinnt. Historische
  // TODO-Bloecke aus Monate alten Statusdateien duerfen AutoQ nicht wiederbeleben.
  for (const doc of candidates) {
    const items: string[] = [];
    for (const section of sections(doc.content ?? "").filter((entry) => NEXT_HEADING.test(entry.heading))) {
      for (const item of bullets(section.lines).filter((entry) => !/^\[x\]/i.test(entry))) {
        pushUnique(items, clip(item.replace(/^\[ \]\s*/, "")), 5);
      }
    }
    if (items.length) return items;
  }
  return [];
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

export interface CapsuleInput {
  projectId: string;
  name: string;
  probe: ProjectProbe;
  verification: ProjectVerification;
  resolutions: Record<string, MismatchResolution>;
  now: string;
}

export function buildContextCapsule(input: CapsuleInput): ContextCapsule {
  const { probe, verification } = input;
  const collected = collectClaims(probe.docs);
  const repo = probe.repo;
  const codeTruth = repo.branch || repo.headSha
    ? clip(`Branch ${repo.branch ?? "(detached)"} @ ${repo.headSha?.slice(0, 7) ?? "?"}${repo.headDate ? `, letzter Commit ${repo.headDate.slice(0, 10)}` : ""}`)
    : null;
  const wantsCode = verification.findings.some((finding) => finding.resolved === "use_code_truth");
  const documented = collected?.claims.waveText ?? null;
  let currentWave: ContextCapsule["currentWave"];
  if (wantsCode && codeTruth) currentWave = { text: codeTruth, basis: "code_truth" };
  else if (documented) currentWave = { text: documented, basis: "documented" };
  else if (codeTruth) currentWave = { text: codeTruth, basis: "code_truth" };
  else currentWave = { text: null, basis: "none" };

  const nextSafeWork: string[] = [];
  const open = verification.findings.find((finding) => !finding.resolved && finding.choices.length > 0);
  if (open) nextSafeWork.push(clip(`Dokumentation und Code abgleichen: ${open.detail}`));
  for (const item of nextWorkOf(probe.docs)) pushUnique(nextSafeWork, item, 6);

  return {
    schema: "katosync.project-capsule/v1",
    projectId: input.projectId,
    name: clip(input.name, 80),
    generatedAt: input.now,
    purpose: purposeOf(probe.docs),
    architecture: architectureOf(probe),
    guardrails: guardrailsOf(probe.docs),
    currentWave,
    branches: repo.worktrees.slice(0, 12).map((worktree) => ({
      name: clip(baseName(worktree.path), 80),
      branch: worktree.branch,
      dirty: (worktree.dirtyCount ?? 0) > 0
    })),
    lastVerification: { state: verification.state, checkedAt: verification.checkedAt, headSha: verification.headSha },
    nextSafeWork,
    sources: probe.docs.filter((doc) => doc.content !== null && doc.excluded === null).map((doc) => doc.path).sort()
  };
}
