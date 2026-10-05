// Created by NMKato Solutions
// Context Verification: vergleicht den DOKUMENTIERTEN Stand (Status-/Handoff-Dokumente) mit der
// Git-/Code-Wahrheit. Rein und deterministisch. Nichts wird still korrigiert: Abweichungen werden als
// Befunde mit sicheren Auswahlmoeglichkeiten gemeldet; die Entscheidung bleibt beim Nutzer.
import type {
  DocFact,
  MismatchChoice,
  MismatchResolution,
  ProjectProbe,
  ProjectVerification,
  VerificationFinding,
  VerificationState
} from "../types";
import { redactSecrets } from "./projectExclusions.ts";

export const STATUS_STALE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DETAIL = 180;

export interface StatusClaims {
  updatedAt: string | null;
  branch: string | null;
  headSha: string | null;
  version: string | null;
  waveText: string | null;
  prRefs: Array<{ ref: string; pending: boolean; line: string }>;
  humanGates: string[];
}

const clip = (value: string, max = MAX_DETAIL) => {
  const clean = redactSecrets(value.replace(/\s+/g, " ").trim());
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const PENDING_WORDS = /\b(draft|open|offen|review|pending|ausstehend|wartet|in review|awaiting)\b/i;
const DONE_WORDS = /\b(merged|gemergt|closed|geschlossen|erledigt|done|abgeschlossen)\b/i;
const GATE_WORDS = /(human[- ]?gate|freigabe\s+(ausstehend|erforderlich|offen)|wartet\s+auf\s+(die\s+)?freigabe|needs?\s+(human\s+)?approval|menschliche\s+freigabe)/i;

function isoDay(value: string): string | null {
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}

/** Liest Behauptungen aus Status-/Handoff-Text. Fehlende Angaben bleiben null – es wird nichts erraten. */
export function parseStatusClaims(content: string): StatusClaims {
  const lines = content.split(/\r?\n/);
  const claims: StatusClaims = { updatedAt: null, branch: null, headSha: null, version: null, waveText: null, prRefs: [], humanGates: [] };
  const seenRefs = new Set<string>();
  for (const raw of lines) {
    const line = raw.replace(/[*_`]/g, "");
    if (!claims.updatedAt) {
      const date = /(?:stand|zuletzt aktualisiert|last updated|updated|aktualisiert|datum|date)\s*[:：-]?\s*(\d{4}-\d{2}-\d{2})/i.exec(line);
      if (date) claims.updatedAt = isoDay(date[1]);
    }
    if (!claims.branch) {
      const branch = /\b(?:branch|zweig)\s*[:：]\s*([A-Za-z0-9._/-]{2,})/i.exec(line);
      if (branch) claims.branch = branch[1].replace(/^refs\/heads\//, "");
    }
    if (!claims.headSha) {
      const sha = /\b(?:head|commit|sha|baseline)\b\s*[:：@=]?\s*([0-9a-f]{7,40})\b/i.exec(line);
      if (sha && /\d/.test(sha[1])) claims.headSha = sha[1].toLowerCase();
    }
    if (!claims.version) {
      const version = /\bversion\s*[:：]?\s*v?(\d+\.\d+\.\d+)/i.exec(line);
      if (version) claims.version = version[1];
    }
    if (!claims.waveText) {
      const wave = /^\s*(?:[-*]\s*)?(?:aktuelle\s+welle|current\s+wave|welle|wave|aktuelle\s+phase|current\s+phase|aktueller\s+stand|current\s+state)\s*[:：]\s*(.+)$/i.exec(line);
      if (wave) claims.waveText = clip(wave[1]);
    }
    const isPr = /(?:\bPR\b|pull request|\/pull\/)/i.test(line);
    const isIssue = /\bissue\b|\/issues\//i.test(line);
    if (isPr || isIssue) {
      for (const match of line.matchAll(/(?:\/pull\/|\/issues\/|#)(\d{1,6})\b/g)) {
        const ref = `${isPr ? "PR" : "Issue"} #${match[1]}`;
        if (seenRefs.has(ref)) continue;
        seenRefs.add(ref);
        claims.prRefs.push({ ref, pending: isPr && PENDING_WORDS.test(line) && !DONE_WORDS.test(line), line: clip(line) });
      }
    }
    const policyHeading = /^\s*#{1,6}\s+/.test(raw) || /\bpolicy\b/i.test(line);
    if (!policyHeading && GATE_WORDS.test(line) && !DONE_WORDS.test(line) && claims.humanGates.length < 5) {
      claims.humanGates.push(clip(line));
    }
  }
  return claims;
}

function dayOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / DAY_MS);
}

function cleanBranch(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^refs\/heads\//, "").replace(/^origin\//, "");
  return trimmed ? trimmed : null;
}

const CHOICES_DECIDE: MismatchChoice[] = ["use_code_truth", "keep_docs_baseline", "inspect"];

function isStatusDoc(doc: DocFact): boolean {
  return (doc.kind === "status" || doc.kind === "handoff") && doc.content !== null && doc.excluded === null;
}

/** Fuehrt die Behauptungen aller lesbaren Status-/Handoff-Dokumente zusammen (frischestes Datum gewinnt). */
export function collectClaims(docs: DocFact[]): { claims: StatusClaims; sources: string[]; docDay: string | null } | null {
  const readable = docs.filter(isStatusDoc);
  if (!readable.length) return null;
  const parsed = readable.map((doc) => ({ doc, claims: parseStatusClaims(doc.content ?? "") }));
  parsed.sort((a, b) => (dayOf(b.claims.updatedAt ?? b.doc.modifiedAt) ?? -1) - (dayOf(a.claims.updatedAt ?? a.doc.modifiedAt) ?? -1) || a.doc.path.localeCompare(b.doc.path));
  const merged: StatusClaims = { updatedAt: null, branch: null, headSha: null, version: null, waveText: null, prRefs: [], humanGates: [] };
  const refs = new Set<string>();
  const freshestDay = dayOf(parsed[0]?.claims.updatedAt ?? parsed[0]?.doc.modifiedAt);
  // Alte Statusdateien duerfen aktuelle Handoffs nicht mit historischen Branch-/PR-/Gate-Claims vergiften.
  // Wenn eine frischere Quelle existiert, werden nur Quellen aus demselben 3-Tage-Fenster zusammengefuehrt.
  const current = parsed.filter(({ claims, doc }) => {
    if (freshestDay === null) return true;
    const candidateDay = dayOf(claims.updatedAt ?? doc.modifiedAt);
    return candidateDay !== null && freshestDay - candidateDay <= STATUS_STALE_DAYS;
  });
  for (const { claims } of current.length ? current : parsed) {
    merged.updatedAt ??= claims.updatedAt;
    merged.branch ??= claims.branch;
    merged.headSha ??= claims.headSha;
    merged.version ??= claims.version;
    merged.waveText ??= claims.waveText;
    for (const ref of claims.prRefs) if (!refs.has(ref.ref)) (refs.add(ref.ref), merged.prRefs.push(ref));
    for (const gate of claims.humanGates) if (merged.humanGates.length < 5 && !merged.humanGates.includes(gate)) merged.humanGates.push(gate);
  }
  const best = parsed[0];
  const docDay = merged.updatedAt ?? (best.doc.modifiedAt ? best.doc.modifiedAt.slice(0, 10) : null);
  return { claims: merged, sources: parsed.map((entry) => entry.doc.path), docDay };
}

const PRECEDENCE: VerificationState[] = ["docs_mismatch", "human_gate", "dirty_worktree", "review_pending", "status_stale", "no_status_doc"];

/** Schlagzeile: hoechster OFFENER Befund; aufgeloeste Befunde zaehlen nicht, ohne offenen Befund gilt "verified". */
export function headlineState(findings: VerificationFinding[]): VerificationState {
  return PRECEDENCE.find((candidate) => findings.some((finding) => finding.state === candidate && !finding.resolved)) ?? "verified";
}

export interface VerifyInput {
  probe: ProjectProbe;
  resolutions: Record<string, MismatchResolution>;
  now: string;
  staleDays?: number;
}

export function verifyProject(input: VerifyInput): ProjectVerification {
  const { probe, now } = input;
  const staleDays = input.staleDays ?? STATUS_STALE_DAYS;
  const repo = probe.repo;
  const findings: VerificationFinding[] = [];
  const add = (finding: Omit<VerificationFinding, "choices" | "resolved"> & { choices?: MismatchChoice[] }) => {
    const choices = finding.choices ?? [];
    const resolution = choices.length ? input.resolutions[finding.id] : undefined;
    // Eine Entscheidung gilt nur fuer den Stand, auf dem sie getroffen wurde.
    const valid = resolution && resolution.headSha === repo.headSha ? resolution.choice : null;
    findings.push({ ...finding, choices, resolved: valid });
  };

  const collected = collectClaims(probe.docs);
  if (!collected) {
    add({ id: "no_status_doc", state: "no_status_doc", severity: "info", detail: "Kein lesbares Status- oder Handoff-Dokument gefunden." });
  } else {
    const { claims, docDay } = collected;
    const headDay = dayOf(repo.headDate);
    const docDayNumber = dayOf(docDay);
    if (headDay !== null && docDayNumber !== null && headDay - docDayNumber > staleDays) {
      add({
        id: "stale_date",
        state: "status_stale",
        severity: "warn",
        detail: `Status ist vom ${docDay}, der letzte Commit vom ${repo.headDate?.slice(0, 10)}.`,
        docValue: docDay,
        codeValue: repo.headDate?.slice(0, 10) ?? null,
        choices: CHOICES_DECIDE
      });
    }
    if (claims.headSha) {
      const sha = claims.headSha;
      const index = repo.recentShas.findIndex((entry) => entry.startsWith(sha) || sha.startsWith(entry));
      if (index > 0) {
        add({
          id: "stale_head",
          state: "status_stale",
          severity: "warn",
          detail: `Dokumentierter Commit ${sha.slice(0, 7)} liegt ${index} Commit${index === 1 ? "" : "s"} hinter HEAD.`,
          docValue: sha.slice(0, 7),
          codeValue: repo.headSha?.slice(0, 7) ?? null,
          choices: CHOICES_DECIDE
        });
      } else if (index < 0 && repo.recentShas.length) {
        add({
          id: "mismatch_head",
          state: "docs_mismatch",
          severity: "danger",
          detail: `Dokumentierter Commit ${sha.slice(0, 7)} ist im aktuellen Verlauf nicht enthalten.`,
          docValue: sha.slice(0, 7),
          codeValue: repo.headSha?.slice(0, 7) ?? null,
          choices: CHOICES_DECIDE
        });
      }
    }
    const documentedBranch = cleanBranch(claims.branch);
    if (documentedBranch) {
      const branches = new Set([repo.branch, ...repo.worktrees.map((worktree) => worktree.branch)].map(cleanBranch).filter(Boolean));
      if (!branches.has(documentedBranch)) {
        add({
          id: "mismatch_branch",
          state: "docs_mismatch",
          severity: "warn",
          detail: `Dokumentierter Branch ${documentedBranch} ist weder ausgecheckt noch als Worktree vorhanden.`,
          docValue: documentedBranch,
          codeValue: cleanBranch(repo.branch),
          choices: CHOICES_DECIDE
        });
      }
    }
    if (claims.version) {
      const manifest = probe.manifests.find((entry) => entry.version);
      if (manifest?.version && manifest.version !== claims.version) {
        add({
          id: "mismatch_version",
          state: "docs_mismatch",
          severity: "warn",
          detail: `Dokumentierte Version ${claims.version}, ${manifest.path} sagt ${manifest.version}.`,
          docValue: claims.version,
          codeValue: manifest.version,
          choices: CHOICES_DECIDE
        });
      }
    }
    const pending = claims.prRefs.filter((ref) => ref.pending);
    if (pending.length) {
      add({
        id: "pr_pending",
        state: "review_pending",
        severity: "info",
        detail: `Laut Status noch offen: ${pending.map((ref) => ref.ref).slice(0, 6).join(", ")} (nicht gegen GitHub geprüft).`,
        docValue: pending.map((ref) => ref.ref).join(", ")
      });
    }
    if (claims.humanGates.length) {
      add({ id: "human_gate", state: "human_gate", severity: "warn", detail: claims.humanGates[0], docValue: claims.humanGates.join(" | ") });
    }
  }

  const otherDirty = repo.worktrees
    .filter((worktree) => worktree.path !== repo.path)
    .reduce((sum, worktree) => sum + (worktree.dirtyCount ?? 0), 0);
  const dirty = repo.dirtyCount + otherDirty;
  if (dirty > 0) {
    add({
      id: "dirty",
      state: "dirty_worktree",
      severity: "warn",
      detail: `${dirty} lokale Änderung${dirty === 1 ? "" : "en"} nicht committet.`,
      codeValue: String(dirty)
    });
  }
  if ((repo.ahead ?? 0) > 0) {
    add({
      id: "unpushed",
      state: "review_pending",
      severity: "info",
      detail: `${repo.ahead} Commit${repo.ahead === 1 ? "" : "s"} noch nicht gepusht.`,
      codeValue: String(repo.ahead)
    });
  }

  return { state: headlineState(findings), findings, checkedAt: now, headSha: repo.headSha };
}

export function applyResolution(
  resolutions: Record<string, MismatchResolution>,
  findingId: string,
  choice: "use_code_truth" | "keep_docs_baseline",
  headSha: string | null,
  now: string
): Record<string, MismatchResolution> {
  return { ...resolutions, [findingId]: { choice, at: now, headSha } };
}
