// Created by NMKato Solutions
// Discovery-Gruppierung: macht aus rohen Git-Fakten (Rust-Adapter) kanonische Projekte. Rein und
// deterministisch – kein Dateisystem, kein Git. Mehrere Worktrees/Klone desselben Repositories sind
// EIN Projekt; die Identitaet kommt aus dem Remote (ohne Zugangsdaten), sonst aus dem gemeinsamen Git-Ordner.
import type { DiscoveredProject, ProjectRegistry, RepoFacts, WorktreeFact } from "../types";
import { normalizeRemote } from "./projectExclusions.ts";
import { profileEntryFor, projectKey } from "./projectFocus.ts";

/** Kanonische Identitaet eines Checkouts. */
export function canonicalIdentityKey(repo: Pick<RepoFacts, "remote" | "commonDir" | "path">): string {
  const remote = normalizeRemote(repo.remote);
  if (remote) return `remote:${remote}`;
  return `local:${repo.commonDir ?? repo.path}`;
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

/** Anzeigename: Repo-Segment des Remotes (Originalschreibweise), sonst Ordnername des Haupt-Checkouts. */
function displayName(repo: RepoFacts, primaryPath: string): string {
  const segment = repo.remote?.replace(/\/+$/, "").replace(/\.git$/i, "").split(/[/:]/).pop();
  return segment?.trim() || baseName(primaryPath);
}

// Kleiner, stabiler 32-Bit-FNV-Hash fuer Kollisions-Suffixe (kein Sicherheitsmerkmal).
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 6);
}

export function slugifyProjectId(name: string): string {
  return projectKey(name) || "projekt";
}

function pickPrimary(members: RepoFacts[]): RepoFacts {
  const main = members.find((repo) => repo.mainWorktreePath && repo.path === repo.mainWorktreePath);
  if (main) return main;
  const unlinked = members.filter((repo) => !repo.isLinkedWorktree);
  const pool = unlinked.length ? unlinked : members;
  return [...pool].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0];
}

function mergeWorktrees(members: RepoFacts[]): WorktreeFact[] {
  const byPath = new Map<string, WorktreeFact>();
  for (const repo of members) {
    for (const worktree of repo.worktrees) {
      const known = byPath.get(worktree.path);
      // Fakten des Checkouts selbst sind frischer als die Listenansicht eines Nachbarn.
      if (!known || (known.dirtyCount === null && worktree.dirtyCount !== null)) byPath.set(worktree.path, worktree);
    }
    if (!byPath.has(repo.path)) {
      byPath.set(repo.path, {
        path: repo.path,
        branch: repo.branch,
        headSha: repo.headSha,
        detached: repo.detached,
        locked: false,
        dirtyCount: repo.dirtyCount
      });
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Gruppiert Funde nach kanonischer Identitaet. Bereits registrierte Projekte behalten ihre ID; neue IDs
 * sind der Repo-Slug (bei bekanntem Fokus-Profil dessen ID) und bei Kollision mit Hash-Suffix eindeutig.
 */
export function groupDiscoveredRepos(repos: RepoFacts[], registry: ProjectRegistry | null = null): DiscoveredProject[] {
  const groups = new Map<string, RepoFacts[]>();
  for (const repo of repos) {
    const key = canonicalIdentityKey(repo);
    groups.set(key, [...(groups.get(key) ?? []), repo]);
  }
  const existingByIdentity = new Map((registry?.projects ?? []).map((project) => [project.identityKey, project]));
  const takenIds = new Set((registry?.projects ?? []).map((project) => project.id));
  const profileTaken = new Set<string>();
  const result: DiscoveredProject[] = [];

  for (const [identityKey, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const primary = pickPrimary(members);
    const rootPath = primary.mainWorktreePath ?? primary.path;
    const name = displayName(primary, rootPath);
    const known = existingByIdentity.get(identityKey);
    const profile = profileEntryFor([name, baseName(rootPath), normalizeRemote(primary.remote)?.split("/").pop()]);
    // Standardprofil-IDs gehen an genau ein Projekt (das erste in deterministischer Reihenfolge).
    const profileId = profile && !profileTaken.has(profile.id) && (!known || known.id === profile.id) ? profile.id : null;
    if (profileId) profileTaken.add(profileId);

    let id = known?.id ?? profileId ?? slugifyProjectId(name);
    if (!known && takenIds.has(id)) id = `${id}-${shortHash(identityKey)}`;
    if (!known) takenIds.add(id);

    const worktrees = mergeWorktrees(members);
    const dirtyCount = worktrees.reduce((sum, worktree) => sum + (worktree.dirtyCount ?? 0), 0);
    result.push({
      id,
      name,
      identityKey,
      remote: primary.remote,
      rootPath,
      commonDir: primary.commonDir,
      branch: primary.branch,
      headSha: primary.headSha,
      dirtyCount,
      worktrees,
      checkoutCount: worktrees.length,
      alreadyRegistered: Boolean(known),
      profileId
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
