// Created by NMKato Solutions
// Projekte & Fokus: Projekt hinzufuegen (Ordner/Workspace), Fundliste mit Checkboxen, Focus Portfolio und
// Projektkarten mit verifiziertem "Wo stehen wir?"-Stand. Reine View – Zustand und Aktionen kommen aus dem
// ProjectRegistryViewModel, Ableitungen aus src/lib/project*.ts.
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useT, type TFunc, type TKey } from "../i18n";
import { AUTO_MODES, FOCUS_PRIORITIES, FOCUS_STATUSES } from "../lib/projectFocus";
import { normalizeRemote } from "../lib/projectExclusions";
import {
  classifyProjectWorktrees,
  uniqueProjectTargets,
  type ProjectTargetKind
} from "../lib/projectTargets";
import type {
  DiscoveredProject,
  FocusPriority,
  FocusStatus,
  MismatchChoice,
  ProjectAutoMode,
  RegistryProject,
  VerificationFinding,
  VerificationState
} from "../types";
import type { useKatoSyncViewModel } from "../viewmodels/useKatoSyncViewModel";

type ViewModel = ReturnType<typeof useKatoSyncViewModel>;

const STATE_TONE: Record<VerificationState, "ok" | "warn" | "danger" | "info"> = {
  verified: "ok",
  status_stale: "warn",
  dirty_worktree: "warn",
  review_pending: "info",
  human_gate: "warn",
  docs_mismatch: "danger",
  no_status_doc: "info",
  unscanned: "info"
};

function stamp(value: string | null | undefined): string {
  return value ? value.slice(0, 16).replace("T", " ") : "";
}

function repoLabel(project: RegistryProject): string {
  return normalizeRemote(project.remote)?.split("/").slice(-2).join("/") ?? project.rootPath.split("/").pop() ?? project.name;
}

function repoCandidateLabel(project: DiscoveredProject): string {
  return normalizeRemote(project.remote)?.split("/").slice(-2).join("/") ?? project.rootPath.split("/").pop() ?? project.name;
}

function projectInitials(name: string): string {
  const parts = name
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "P";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function ProjectCandidateVisual({ candidate }: { candidate: DiscoveredProject }) {
  return (
    <span className="projects-candidate-visual" aria-hidden="true">
      {candidate.iconDataUrl ? (
        <img alt="" src={candidate.iconDataUrl} />
      ) : (
        <span className="projects-candidate-monogram">
          <FolderGit2 size={18} />
          <b>{projectInitials(candidate.name)}</b>
        </span>
      )}
    </span>
  );
}

export function ProjectRegistryWorkspace({ vm }: { vm: ViewModel }) {
  const { t } = useT();
  const projects = vm.projects;
  const [adding, setAdding] = useState(false);
  const active = projects.portfolio.filter((project) => project.focus.status === "active");
  const inactive = projects.portfolio.filter((project) => project.focus.status !== "active");
  const excludedTasks = vm.agentSync.autoLanes.excluded.reduce((sum, entry) => sum + entry.taskIds.length, 0);
  const busy = projects.busy !== null;

  return (
    <section className="agent-projects" id="section-agent-projects">
      <header className="glass agent-card projects-head">
        <div>
          <div className="agent-card-title">
            <FolderGit2 size={17} />
            <h3>{t("projects.title")}</h3>
          </div>
          <p className="agent-empty">{t("projects.subtitle")}</p>
        </div>
        <div className="projects-head-actions">
          <button className="primary" disabled={busy} onClick={() => setAdding((open) => !open)} type="button">
            <Plus size={15} />
            {t("projects.add")}
          </button>
          {projects.registry.projects.length ? (
            <button className="ghost compact-button" disabled={busy} onClick={() => void projects.rescanAll()} type="button">
              {projects.busy === "scan" ? <Loader2 className="spin" size={14} /> : <RefreshCcw size={14} />}
              {t("projects.rescanAll")}
            </button>
          ) : null}
        </div>
      </header>

      {adding && !projects.discovery ? (
        <div className="glass agent-card projects-add" role="group" aria-label={t("projects.add.title")}>
          <strong>{t("projects.add.title")}</strong>
          <div className="projects-add-choices">
            <AddChoice
              busy={projects.busy === "discover"}
              button={t("projects.add.one.button")}
              description={t("projects.add.one.desc")}
              onClick={() => void projects.startDiscovery("project").then(() => setAdding(false))}
              title={t("projects.add.one")}
            />
            <AddChoice
              busy={projects.busy === "discover"}
              button={t("projects.add.workspace.button")}
              description={t("projects.add.workspace.desc")}
              onClick={() => void projects.startDiscovery("workspace").then(() => setAdding(false))}
              title={t("projects.add.workspace")}
            />
          </div>
          <small className="projects-privacy">
            <ShieldCheck size={13} /> {t("projects.add.privacy")}
          </small>
        </div>
      ) : null}

      {projects.busy === "discover" ? (
        <p className="agent-empty" role="status">
          <Loader2 className="spin" size={14} /> {t("projects.discover.busy")}
        </p>
      ) : null}

      {projects.discovery ? <DiscoveryList vm={vm} /> : null}

      {projects.legacyRoots.length && projects.legacyStatus.sourceRoots.status !== "done" && !projects.discovery ? (
        <div className="glass agent-card projects-legacy">
          <strong>{t("projects.legacy.title")}</strong>
          <p className="agent-empty">{t("projects.legacy.text")}</p>
          <button className="secondary compact-button" disabled={busy} onClick={() => void projects.scanLegacyRoots()} type="button">
            {t("projects.legacy.button")}
          </button>
        </div>
      ) : null}
      {projects.legacyRoots.length && projects.legacyStatus.sourceRoots.status === "done" ? (
        <p className="agent-empty projects-legacy-done">{t("projects.legacy.done")}</p>
      ) : null}

      <section className="glass agent-card projects-portfolio" aria-label={t("projects.focus.title")}>
        <div className="agent-card-title">
          <Check size={17} />
          <h3>{t("projects.focus.title")}</h3>
        </div>
        {active.length ? (
          <ul className="projects-focus-list">
            {active.map((project) => (
              <li key={project.id}>
                <span className={`projects-prio ${project.focus.priority}`}>{project.focus.priority}</span>
                <strong>{project.name}</strong>
                <small>{t(`projects.auto.${project.focus.autoMode}` as TKey)}</small>
                {project.focus.scope ? <small className="projects-scope" title={project.focus.scope}>{project.focus.scope}</small> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="agent-empty">{t("projects.focus.empty")}</p>
        )}
        {!projects.registry.projects.length ? <p className="agent-empty">{t("projects.focus.noRegistry")}</p> : null}
        {excludedTasks > 0 ? <p className="agent-empty">{t("projects.focus.excluded", { count: excludedTasks })}</p> : null}
        {projects.missingProfile.length && projects.registry.projects.length ? <MissingProfile vm={vm} /> : null}
      </section>

      {!projects.registry.projects.length && !projects.discovery ? <p className="agent-empty projects-empty">{t("projects.empty")}</p> : null}

      <div className="projects-cards">
        {active.map((project) => (
          <ProjectCard key={project.id} project={project} vm={vm} />
        ))}
      </div>
      {inactive.length ? (
        <details className="projects-inactive">
          <summary>
            {t("projects.section.inactive")} ({inactive.length})
          </summary>
          <div className="projects-cards">
            {inactive.map((project) => (
              <ProjectCard key={project.id} project={project} vm={vm} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function AddChoice(props: { title: string; description: string; button: string; busy: boolean; onClick: () => void }) {
  return (
    <div className="projects-add-choice">
      <strong>{props.title}</strong>
      <small>{props.description}</small>
      <button className="secondary compact-button" disabled={props.busy} onClick={props.onClick} type="button">
        <FolderOpen size={14} />
        {props.button}
      </button>
    </div>
  );
}

function DiscoveryList({ vm }: { vm: ViewModel }) {
  const { t } = useT();
  const projects = vm.projects;
  const discovery = projects.discovery;
  if (!discovery) return null;
  const selectable = discovery.candidates.filter((candidate) => !candidate.alreadyRegistered);
  return (
    <div className="glass agent-card projects-discovery">
      <div className="projects-discovery-head">
        <strong>{t("projects.discover.title")}</strong>
        <span>
          <button className="ghost compact-button" onClick={() => projects.selectAllCandidates(true)} type="button">
            {t("projects.discover.selectAll")}
          </button>
          <button className="ghost compact-button" onClick={() => projects.selectAllCandidates(false)} type="button">
            {t("projects.discover.selectNone")}
          </button>
        </span>
      </div>
      <small>{t("projects.discover.hint")}</small>
      {discovery.truncated ? (
        <small className="tone-warn">
          <AlertTriangle size={13} /> {t("projects.discover.truncated")}
        </small>
      ) : null}
      <ul className="projects-candidates" aria-label={t("projects.discover.title")}>
        {discovery.candidates.map((candidate) => {
          const selected = candidate.alreadyRegistered || discovery.selected.includes(candidate.id);
          return (
            <li
              className={`${candidate.alreadyRegistered ? "registered " : ""}${selected ? "selected" : ""}`.trim()}
              key={candidate.id}
            >
              <label className="projects-candidate-card">
                <input
                  aria-label={candidate.name}
                  checked={selected}
                  disabled={candidate.alreadyRegistered}
                  onChange={() => projects.toggleCandidate(candidate.id)}
                  type="checkbox"
                />
                <ProjectCandidateVisual candidate={candidate} />
                <span className="projects-candidate-copy">
                  <strong title={candidate.name}>{candidate.name}</strong>
                  <small className="projects-candidate-repo" title={candidate.rootPath}>
                    {repoCandidateLabel(candidate)}
                  </small>
                  <span className="projects-candidate-meta">
                    <small
                      className="projects-candidate-branch"
                      title={`${candidate.branch ?? "—"}${candidate.headSha ? ` @ ${candidate.headSha.slice(0, 7)}` : ""}`}
                    >
                      <GitBranch size={12} />
                      <span>
                        {candidate.branch ?? "—"}
                        {candidate.headSha ? ` @ ${candidate.headSha.slice(0, 7)}` : ""}
                      </span>
                    </small>
                    <span className="projects-candidate-stats">
                      {candidate.checkoutCount > 1 ? <small>{t("projects.discover.worktrees", { count: candidate.checkoutCount })}</small> : null}
                      {candidate.dirtyCount > 0 ? <small className="tone-warn">{t("projects.discover.dirty", { count: candidate.dirtyCount })}</small> : null}
                      {candidate.alreadyRegistered ? <small>{t("projects.discover.registered")}</small> : null}
                    </span>
                    {candidate.profileId ? (
                      <small className="projects-candidate-known" title={candidate.profileId}>
                        {t("projects.discover.known", {
                          id: t(`projects.focus.profile.${candidate.profileId}` as TKey)
                        })}
                      </small>
                    ) : null}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="projects-discovery-actions">
        <button
          className="primary"
          disabled={projects.busy !== null || !discovery.selected.some((id) => selectable.some((candidate) => candidate.id === id))}
          onClick={() => void projects.addSelected()}
          type="button"
        >
          {t("projects.discover.confirm", { count: discovery.selected.filter((id) => selectable.some((candidate) => candidate.id === id)).length })}
        </button>
        <button className="ghost" onClick={projects.cancelDiscovery} type="button">
          {t("projects.discover.cancel")}
        </button>
      </div>
    </div>
  );
}

function MissingProfile({ vm }: { vm: ViewModel }) {
  const { t } = useT();
  const projects = vm.projects;
  const [choice, setChoice] = useState<Record<string, string>>({});
  return (
    <div className="projects-missing">
      <div className="projects-missing-head">
        <div>
          <strong>{t("projects.focus.autoTitle")}</strong>
          <small>{t("projects.focus.autoHint")}</small>
        </div>
        <button
          className="primary compact-button"
          disabled={projects.busy !== null}
          onClick={() => void projects.autoDiscoverFocus()}
          type="button"
        >
          {projects.busy === "discover" ? <Loader2 className="spin" size={14} /> : <Search size={14} />}
          {t("projects.focus.autoFind")}
        </button>
      </div>

      <div className="projects-missing-summary">
        {projects.missingProfile.map((entry) => (
          <div className="projects-missing-chip" key={entry.id}>
            <span className={`projects-prio ${entry.priority}`}>{entry.priority}</span>
            <span>
              <strong>{t(`projects.focus.profile.${entry.id}` as TKey)}</strong>
              <small>{t("projects.focus.autoPending")}</small>
            </span>
          </div>
        ))}
      </div>

      <details className="projects-manual-link">
        <summary>{t("projects.focus.manual")}</summary>
        <small>{t("projects.focus.missing.hint")}</small>
        <ul>
          {projects.missingProfile.map((entry) => (
            <li key={entry.id}>
              <span className={`projects-prio ${entry.priority}`}>{entry.priority}</span>
              <strong>{t(`projects.focus.profile.${entry.id}` as TKey)}</strong>
              <select
                aria-label={`${entry.id} ${t("projects.focus.link")}`}
                onChange={(event) => setChoice((current) => ({ ...current, [entry.id]: event.target.value }))}
                value={choice[entry.id] ?? ""}
              >
                <option value="">{t("projects.focus.linkPick")}</option>
                {projects.registry.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button
                className="secondary compact-button"
                disabled={!choice[entry.id]}
                onClick={() => projects.linkProfile(entry.id, choice[entry.id])}
                type="button"
              >
                {t("projects.focus.link")}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function targetLabel(kind: ProjectTargetKind, t: TFunc): string {
  return t(`projects.target.${kind}` as TKey);
}

function worktreeShortName(path: string): string {
  const clean = path.replace(/\/+$/, "");
  return clean.split("/").pop() || clean;
}

function ProjectCard({ project, vm }: { project: RegistryProject; vm: ViewModel }) {
  const { t } = useT();
  const projects = vm.projects;
  const [details, setDetails] = useState(false);
  const scanning = projects.scanning.includes(project.id);
  const error = projects.scanErrors[project.id];
  const state: VerificationState = project.verification?.state ?? "unscanned";
  const wave = project.capsule?.currentWave;
  const worktrees = project.scan?.worktrees ?? [];
  const worktreeCount = worktrees.length || 1;
  const worktreeTargets = classifyProjectWorktrees(project.name, worktrees);
  const targetKinds = uniqueProjectTargets(project.name, worktrees);
  const mappedFolder = vm.config?.projectRepos?.[project.id];
  return (
    <article className={`glass agent-card projects-card status-${project.focus.status}`}>
      <div className="projects-card-top">
        <div>
          <strong className="projects-card-name">{project.name}</strong>
          <small>
            {repoLabel(project)}
            {project.scan?.branch ? ` · ${project.scan.branch}` : ""}
            {project.scan?.headSha ? ` @ ${project.scan.headSha.slice(0, 7)}` : ""}
          </small>
        </div>
        <span className={`projects-badge tone-${STATE_TONE[state]}`}>{scanning ? t("projects.card.scanning") : t(`projects.state.${state}` as TKey)}</span>
      </div>

      <p className="projects-wave">
        <span className="agent-mini-title">{t("projects.card.wave")}</span>
        {wave?.text ?? t("projects.card.wave.none")}
        {wave && wave.basis !== "none" ? <small> · {t(`projects.card.wave.${wave.basis}` as TKey)}</small> : null}
      </p>
      <small className="projects-meta">
        {t("projects.card.worktrees", { count: worktreeCount })}
        {" · "}
        {project.scan ? t("projects.card.checked", { time: stamp(project.scan.scannedAt) }) : t("projects.card.notScanned")}
      </small>
      {targetKinds.length ? (
        <div className="projects-target-badges" aria-label={t("projects.targets.title")}>
          <span className="agent-mini-title">{t("projects.targets.title")}</span>
          {targetKinds.map((kind) => (
            <span className={`projects-target-badge target-${kind}`} key={kind}>
              {targetLabel(kind, t)}
            </span>
          ))}
        </div>
      ) : null}
      {error ? <small className="tone-danger">{t("projects.card.scanError", { error })}</small> : null}

      <div className="projects-controls">
        <FocusSelect
          label={t("projects.field.status")}
          onChange={(value) => projects.setFocus(project.id, { status: value as FocusStatus })}
          options={FOCUS_STATUSES.map((value) => [value, t(`projects.status.${value}` as TKey)])}
          value={project.focus.status}
        />
        <FocusSelect
          label={t("projects.field.priority")}
          onChange={(value) => projects.setFocus(project.id, { priority: value as FocusPriority })}
          options={FOCUS_PRIORITIES.map((value) => [value, value])}
          value={project.focus.priority}
        />
        <FocusSelect
          label={t("projects.field.auto")}
          onChange={(value) => projects.setFocus(project.id, { autoMode: value as ProjectAutoMode })}
          options={AUTO_MODES.map((value) => [value, t(`projects.auto.${value}` as TKey)])}
          value={project.focus.autoMode}
        />
      </div>

      <div className="projects-actions">
        <button className="ghost compact-button" onClick={() => void projects.openFolder(project.id)} type="button">
          <FolderOpen size={14} />
          {t("projects.card.open")}
        </button>
        <button className="ghost compact-button" disabled={scanning} onClick={() => void projects.rescan(project.id)} type="button">
          {scanning ? <Loader2 className="spin" size={14} /> : <RefreshCcw size={14} />}
          {t("projects.card.rescan")}
        </button>
        {worktreeTargets.length <= 1 ? (
          <button
            className="ghost compact-button"
            disabled={mappedFolder === project.rootPath}
            onClick={() => void vm.handleUseProjectFolder(project.id)}
            type="button"
          >
            {mappedFolder === project.rootPath ? t("projects.card.workFolderSet") : t("projects.card.workFolder")}
          </button>
        ) : null}
        <button className="ghost compact-button" onClick={() => setDetails((open) => !open)} aria-expanded={details} type="button">
          <ChevronDown size={14} />
          {t("projects.card.details")}
        </button>
        <button className="ghost compact-button danger" onClick={() => void projects.remove(project.id)} title={t("projects.card.removeHint")} type="button">
          <Trash2 size={14} />
          {t("projects.card.remove")}
        </button>
      </div>

      {worktreeTargets.length > 1 ? (
        <details className="projects-worktree-targets">
          <summary>
            <span>{t("projects.targets.worktrees")}</span>
            <small>{t("projects.targets.count", { count: worktreeTargets.length })}</small>
          </summary>
          <div className="projects-worktree-list">
            {worktreeTargets.map(({ kind, worktree }) => {
              const isMapped = mappedFolder === worktree.path;
              const dirty = (worktree.dirtyCount ?? 0) > 0;
              return (
                <div className={`projects-worktree-row${isMapped ? " selected" : ""}`} key={worktree.path}>
                  <span className={`projects-target-badge target-${kind}`}>{targetLabel(kind, t)}</span>
                  <span className="projects-worktree-copy">
                    <strong title={worktree.path}>{worktreeShortName(worktree.path)}</strong>
                    <small title={worktree.branch ?? worktree.path}>
                      <GitBranch size={11} />
                      <span>{worktree.branch ?? t("projects.targets.detached")}</span>
                    </small>
                  </span>
                  <span className={dirty ? "projects-worktree-state tone-warn" : "projects-worktree-state tone-ok"}>
                    {dirty
                      ? t("projects.targets.dirty", { count: worktree.dirtyCount ?? 0 })
                      : t("projects.targets.clean")}
                  </span>
                  <button
                    className="ghost compact-button"
                    disabled={isMapped}
                    onClick={() =>
                      void vm.handleUseProjectFolder(
                        project.id,
                        worktree.path,
                        `${targetLabel(kind, t)} · ${worktree.branch ?? worktreeShortName(worktree.path)}`,
                        worktree.dirtyCount ?? 0
                      )
                    }
                    type="button"
                  >
                    {isMapped ? t("projects.card.workFolderSet") : t("projects.card.workFolder")}
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}

      {project.verification?.findings.length ? (
        <ul className="projects-findings">
          {project.verification.findings.map((finding) => (
            <Finding finding={finding} key={finding.id} onChoose={(choice) => void projects.decideFinding(project.id, finding.id, choice)} t={t} />
          ))}
        </ul>
      ) : null}
      {details ? <Capsule project={project} t={t} /> : null}
    </article>
  );
}

function FocusSelect(props: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <label className="projects-select">
      <span>{props.label}</span>
      <select onChange={(event) => props.onChange(event.target.value)} value={props.value}>
        {props.options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function Finding({ finding, onChoose, t }: { finding: VerificationFinding; onChoose: (choice: MismatchChoice) => void; t: TFunc }) {
  const [inspect, setInspect] = useState(false);
  const decidable = finding.choices.filter((choice) => choice !== "inspect");
  return (
    <li className={`projects-finding tone-${finding.severity === "danger" ? "danger" : finding.severity === "warn" ? "warn" : "info"}${finding.resolved ? " resolved" : ""}`}>
      <span className="projects-finding-text">
        <strong>{t(`projects.state.${finding.state}` as TKey)}</strong> {finding.detail}
      </span>
      {finding.resolved ? (
        <small>{t("projects.finding.resolved", { choice: t(`projects.choice.${finding.resolved}` as TKey) })}</small>
      ) : finding.choices.length ? (
        <span className="projects-finding-actions">
          {decidable.map((choice) => (
            <button className="secondary compact-button" key={choice} onClick={() => onChoose(choice)} type="button">
              {t(`projects.choice.${choice}` as TKey)}
            </button>
          ))}
          <button className="ghost compact-button" onClick={() => setInspect((open) => !open)} aria-expanded={inspect} type="button">
            {t("projects.choice.inspect")}
          </button>
        </span>
      ) : null}
      {inspect ? (
        <dl className="projects-finding-diff">
          <dt>{t("projects.finding.docs")}</dt>
          <dd>{finding.docValue ?? "—"}</dd>
          <dt>{t("projects.finding.code")}</dt>
          <dd>{finding.codeValue ?? "—"}</dd>
          <dd className="projects-finding-hint">{t("projects.finding.hint")}</dd>
        </dl>
      ) : null}
    </li>
  );
}

function CapsuleList({ title, items }: { title: string; items: string[] }): ReactNode {
  if (!items.length) return null;
  return (
    <div>
      <span className="agent-mini-title">{title}</span>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Capsule({ project, t }: { project: RegistryProject; t: TFunc }) {
  const capsule = project.capsule;
  if (!capsule) return <p className="agent-empty">{t("projects.capsule.empty")}</p>;
  return (
    <div className="projects-capsule">
      <span className="agent-mini-title">{t("projects.capsule.title")}</span>
      {capsule.purpose ? (
        <p>
          <strong>{t("projects.capsule.purpose")}:</strong> {capsule.purpose}
        </p>
      ) : null}
      <CapsuleList items={capsule.architecture} title={t("projects.capsule.architecture")} />
      <CapsuleList items={capsule.guardrails} title={t("projects.capsule.guardrails")} />
      <CapsuleList items={capsule.nextSafeWork} title={t("projects.capsule.next")} />
      <CapsuleList
        items={capsule.branches.map((entry) => `${entry.name}${entry.branch ? ` (${entry.branch})` : ""}${entry.dirty ? " ●" : ""}`)}
        title={t("projects.capsule.branches")}
      />
      <CapsuleList items={capsule.sources} title={t("projects.capsule.sources")} />
    </div>
  );
}
