import type { WorktreeFact } from "../types";

export type ProjectTargetKind = "windows" | "macos" | "local-ai" | "shared";

export interface ProjectWorktreeTarget {
  kind: ProjectTargetKind;
  worktree: WorktreeFact;
}

function haystack(projectName: string, worktree: WorktreeFact): string {
  return [
    projectName,
    worktree.branch ?? "",
    worktree.path.split("/").pop() ?? ""
  ]
    .join(" ")
    .toLowerCase();
}

export function inferWorktreeTarget(projectName: string, worktree: WorktreeFact): ProjectTargetKind {
  const value = haystack(projectName, worktree);

  if (/windows|win32|winui|uia|theorg/.test(value)) return "windows";
  if (/macos|darwin|osx|apple|(^|[-_/ ])mac([-_/ ]|$)/.test(value)) return "macos";
  if (/gemma|cortex|local[-_ ]?(ai|brain|llm)|llama/.test(value)) return "local-ai";
  return "shared";
}

const TARGET_ORDER: ProjectTargetKind[] = ["windows", "macos", "local-ai", "shared"];

export function classifyProjectWorktrees(projectName: string, worktrees: WorktreeFact[]): ProjectWorktreeTarget[] {
  return worktrees
    .map((worktree) => ({ kind: inferWorktreeTarget(projectName, worktree), worktree }))
    .sort((a, b) => {
      const targetDiff = TARGET_ORDER.indexOf(a.kind) - TARGET_ORDER.indexOf(b.kind);
      if (targetDiff) return targetDiff;
      const dirtyA = a.worktree.dirtyCount ?? 0;
      const dirtyB = b.worktree.dirtyCount ?? 0;
      if (dirtyA !== dirtyB) return dirtyA - dirtyB;
      return (a.worktree.branch ?? a.worktree.path).localeCompare(b.worktree.branch ?? b.worktree.path);
    });
}

export function uniqueProjectTargets(projectName: string, worktrees: WorktreeFact[]): ProjectTargetKind[] {
  const found = new Set(classifyProjectWorktrees(projectName, worktrees).map((entry) => entry.kind));
  return TARGET_ORDER.filter((kind) => found.has(kind));
}
