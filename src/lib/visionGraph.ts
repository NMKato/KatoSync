// Created by NMKato Solutions
// Vision v1: provider-neutrale Projektion des KatoSync-Systems als Graph (Knoten + Kanten).
// - Reine Funktion ueber die BESTEHENDEN Wahrheitsquellen: Project Registry, Memory Fabric Overview,
//   Agent-Sync-Lanes, Local-Brain-Status, persistente Device-/Node-ID, Local Control / Remote Orchestrator.
//   Keine zweite Wahrheit: die Projektion speichert nichts und erfindet keine Knoten. Fehlt eine Quelle,
//   wird sie weggelassen (`omitted`) oder ihr Zustand ist `unknown`.
// - Keine Secrets, keine absoluten Pfade: Projekt-Roots, Endpoints, Logpfade, Kommandos und Library-IDs
//   werden nie in Knoten/Fakten uebernommen. Node-IDs erscheinen nur gekuerzt.
// - "Vision" ist der visuelle Systemgraph. Die spaetere multimodale "Sight"-Runtime ist etwas anderes.
import type {
  AgentJobStatus,
  AgentLane,
  AgentLaneId,
  AgentSyncState,
  AppConfig,
  MemoryFabricOverview,
  ProjectMemoryOverview,
  ProjectRegistry,
  ProviderStatus,
  RegistryProject,
  VerificationState
} from "../types.ts";
import { agentBrandAsset, agentLaneBrand, agentLaneDisplayModel, type AgentBrandAsset } from "./agentLanePresentation.ts";
import type { LocalBrainStatus } from "./localBrainCatalog.ts";

export const VISION_GRAPH_SCHEMA = "katosync.vision-graph/v1";
/** Laufzeitzustand (Heartbeat/Check) gilt so lange als frisch. */
export const VISION_RUNTIME_FRESH_MS = 15 * 60_000;

export type VisionNodeKind = "project" | "model" | "local_brain" | "device" | "memory" | "service";
export type VisionEdgeKind =
  | "knows"
  | "works_on"
  | "retrieves_from"
  | "runs_on"
  | "syncs_with"
  | "routes_to"
  | "stores_in"
  | "connected_to";
/** Wie belastbar ist die Aussage? Gleiches Vokabular wie die Memory Fabric, plus `unknown`. */
export type VisionTruth = "canonical" | "verified" | "observed" | "unknown";
export type VisionFreshness = "fresh" | "head_moved" | "stale" | "unknown";
export type VisionActivity = "active" | "ready" | "idle" | "waiting" | "blocked" | "offline" | "unknown";
export type VisionScope = "local" | "lan" | "cloud" | "unknown";
/** Vertrauensgrenze einer Beziehung (wer garantiert sie?). */
export type VisionTrust = "this_device" | "loopback" | "provider_account" | "external_supervisor" | "unknown";
export type VisionDirection = "directed" | "mutual";
export type VisionSource =
  | "katosync"
  | "device_identity"
  | "project_registry"
  | "memory_fabric"
  | "agent_lanes"
  | "local_brain"
  | "local_control"
  | "remote_orchestrator"
  | "mistral_library";
/**
 * Freigegebene lokale Marken-Assets (public/). Dieselbe Markenwahrheit wie Live Control
 * (agentLanePresentation); unbekannte Identitaet zeigt Initialen.
 */
export type VisionAsset = AgentBrandAsset;
/** Quellen, die in dieser Projektion fehlen (ehrlich ausgewiesen statt erfunden). */
export type VisionOmission = "device_identity" | "project_registry" | "memory_fabric" | "agent_lanes" | "local_brain";

export type VisionFactKey =
  | "nodeId"
  | "identity"
  | "branch"
  | "head"
  | "dirty"
  | "focus"
  | "priority"
  | "verification"
  | "scannedAt"
  | "sources"
  | "chunks"
  | "truthMix"
  | "indexedAt"
  | "model"
  | "version"
  | "auth"
  | "connectivity"
  | "reason"
  | "currentJob"
  | "rank"
  | "runtime"
  | "capabilities"
  | "transport"
  | "ownership"
  | "lease"
  | "queue"
  | "activeJobs"
  | "projects"
  | "configured";

export interface VisionFact {
  key: VisionFactKey;
  value: string;
  /** code = uebersetzbarer Code (vision.code.<value>), time = ISO-Zeitpunkt, text = Rohwert. */
  format: "text" | "code" | "time";
}

export interface VisionNode {
  id: string;
  kind: VisionNodeKind;
  /** Leer = UI zeigt eine uebersetzte Standardbezeichnung (z. B. "Dieses Geraet"). */
  label: string;
  short: string;
  subtitle?: string | null;
  asset?: VisionAsset | null;
  scope: VisionScope;
  truth: VisionTruth;
  freshness: VisionFreshness;
  activity: VisionActivity;
  lastActivityAt?: string | null;
  source: VisionSource;
  facts: VisionFact[];
}

export interface VisionEdge {
  id: string;
  kind: VisionEdgeKind;
  from: string;
  to: string;
  direction: VisionDirection;
  scope: VisionScope;
  trust: VisionTrust;
  truth: VisionTruth;
  freshness: VisionFreshness;
  activity: VisionActivity;
  source: VisionSource;
  /** Kurzer, redigierter Evidenz-Code oder Wert (nie Pfad/Secret). */
  evidence?: string | null;
  at?: string | null;
}

export interface VisionGraph {
  schema: typeof VISION_GRAPH_SCHEMA;
  generatedAt: string;
  runtime: "desktop" | "browser_preview";
  nodes: VisionNode[];
  edges: VisionEdge[];
  omitted: VisionOmission[];
}

export interface VisionGraphInput {
  /** false = Browser-Preview: Provider-/Lane-Zustaende sind dort Demo-Werte und werden nicht gezeigt. */
  nativeRuntime: boolean;
  config: Pick<AppConfig, "device" | "libraryId"> | null;
  registry: ProjectRegistry | null;
  agentSync: AgentSyncState | null;
  providerStatuses: ProviderStatus[];
  localBrain: LocalBrainStatus | null;
  memory: MemoryFabricOverview | null;
  /** Ergebnis des letzten Library-Tests (null = nie geprueft). */
  libraryVerified?: boolean | null;
  now: string;
}

export const HUB_NODE_ID = "hub:katosync";
export const MEMORY_STORE_NODE_ID = "storage:memory_fabric";
export const LOCAL_BRAIN_NODE_ID = "brain:local";
export const THIS_DEVICE_NODE_ID = "device:self";

const ACTIVE_JOB: ReadonlySet<AgentJobStatus> = new Set(["running", "verifying", "implemented"]);
const WAITING_JOB: ReadonlySet<AgentJobStatus> = new Set(["queued", "waiting", "retry_wait", "review_ready"]);
const BLOCKED_JOB: ReadonlySet<AgentJobStatus> = new Set(["blocked", "human_gate"]);

// ===== Kleine, getestete Abbildungen =====

/** Projektverifikation -> Wahrheit. Nur ein gegen HEAD gepruefter Stand gilt als verified. */
export function truthFromVerification(state: VerificationState | null | undefined): VisionTruth {
  if (!state || state === "unscanned") return "unknown";
  return state === "verified" ? "verified" : "observed";
}

/** Projektfrische aus Scan + Verifikation (ohne neuen Scan, ohne Dateizugriff). */
export function projectFreshness(project: RegistryProject): VisionFreshness {
  if (!project.scan) return "unknown";
  if (project.verification?.state === "status_stale") return "stale";
  if (!project.verification) return "unknown";
  const verifiedHead = project.verification.headSha;
  const scannedHead = project.scan.headSha;
  if (verifiedHead && scannedHead && verifiedHead !== scannedHead) return "head_moved";
  return "fresh";
}

/** Beste vorhandene Wahrheitsstufe eines Projektwissens (der volle Mix steht in den Fakten). */
export function memoryTruth(memory: ProjectMemoryOverview): VisionTruth {
  if (memory.canonical > 0) return "canonical";
  if (memory.verified > 0) return "verified";
  if (memory.observed > 0) return "observed";
  return "unknown";
}

/**
 * Frische des indexierten Wissens gegen den zuletzt gescannten HEAD aus der Registry.
 * Inhalts-Staleness (geaenderte Quelle bei gleichem HEAD) braucht einen Live-Probe und ist in v1 nicht Teil
 * der Projektion; "fresh" heisst hier ausdruecklich "HEAD unveraendert".
 */
export function memoryFreshness(memory: ProjectMemoryOverview, project: RegistryProject | null): VisionFreshness {
  const liveHead = project?.scan?.headSha ?? null;
  if (!liveHead || !memory.gitHead) return "unknown";
  return liveHead === memory.gitHead ? "fresh" : "head_moved";
}

/** Laufzeit-Frische aus dem Alter des letzten Checks/Heartbeats. */
export function runtimeFreshness(at: string | null | undefined, now: string): VisionFreshness {
  if (!at) return "unknown";
  const age = Date.parse(now) - Date.parse(at);
  if (!Number.isFinite(age)) return "unknown";
  return age <= VISION_RUNTIME_FRESH_MS ? "fresh" : "stale";
}

export function laneActivity(lane: AgentLane): VisionActivity {
  switch (lane.activity) {
    case "active":
      return "active";
    case "waiting":
      return "waiting";
    case "blocked":
      return "blocked";
    case "offline":
      return "offline";
    case "idle":
      return lane.connectivity === "connected" ? "ready" : "idle";
    default:
      return "unknown";
  }
}

/** Eine Lane mit eigenem KatoSync-Check ist verified, nur gemeldete Zustaende sind observed. */
export function laneTruth(lane: AgentLane): VisionTruth {
  if (lane.connectivity === "unknown") return "unknown";
  return lane.checkedAt ? "verified" : "observed";
}

export function jobActivity(status: AgentJobStatus): VisionActivity {
  if (ACTIVE_JOB.has(status)) return "active";
  if (BLOCKED_JOB.has(status)) return "blocked";
  if (WAITING_JOB.has(status)) return "waiting";
  return "idle";
}

const ACTIVITY_RANK: Record<VisionActivity, number> = {
  active: 6,
  blocked: 5,
  waiting: 4,
  ready: 3,
  idle: 2,
  unknown: 1,
  offline: 0
};

function strongerActivity(a: VisionActivity, b: VisionActivity): VisionActivity {
  return ACTIVITY_RANK[a] >= ACTIVITY_RANK[b] ? a : b;
}

/** Kurzlabel/Initialen fuer Knoten ohne freigegebenes Asset. */
export function initials(label: string): string {
  const words = label
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const word = words[0];
    // CamelCase/Marken (KatoSync -> KS), sonst die ersten zwei Zeichen.
    const caps = word.match(/\p{Lu}/gu);
    if (caps && caps.length >= 2 && word.length > 3) return caps.slice(0, 2).join("");
    return word.slice(0, word.length <= 3 ? 3 : 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Node-IDs nur gekuerzt anzeigen (Audit-ID, kein Secret – trotzdem nicht voll im UI ausbreiten). */
export function shortNodeId(nodeId: string): string {
  const id = nodeId.trim();
  return id.length > 11 ? `${id.slice(0, 11)}…` : id;
}

function shortSha(sha: string | null | undefined): string | null {
  return sha ? sha.slice(0, 7) : null;
}

function fact(key: VisionFactKey, value: string | number | null | undefined, format: VisionFact["format"] = "text"): VisionFact[] {
  if (value === null || value === undefined || value === "") return [];
  return [{ key, value: String(value), format }];
}

function edgeId(kind: VisionEdgeKind, from: string, to: string): string {
  return `${kind}:${from}->${to}`;
}

// ===== Projektion =====

/** Registry-Projekt zu einer (evtl. Alias-)ID, ohne neue Projekte zu erfinden. */
export function resolveRegistryProject(registry: ProjectRegistry | null, projectId: string | null | undefined): RegistryProject | null {
  if (!registry || !projectId) return null;
  return (
    registry.projects.find((project) => project.id === projectId) ??
    registry.projects.find((project) => project.aliases.includes(projectId)) ??
    null
  );
}

function laneNodeId(id: AgentLaneId, localLaneIsBrain: boolean): string {
  switch (id) {
    case "local":
      return localLaneIsBrain ? LOCAL_BRAIN_NODE_ID : "lane:local";
    case "local_control":
      return "service:local_control";
    case "remote_orchestrator":
      return "service:remote_orchestrator";
    default:
      return `lane:${id}`;
  }
}

const LANE_LABEL: Record<AgentLaneId, string> = {
  codex: "Codex",
  claude: "Claude",
  local: "Local Model",
  remote_orchestrator: "Remote Orchestrator",
  local_control: "Local Control"
};

function providerScope(status: ProviderStatus | undefined, lane: AgentLaneId): VisionScope {
  if (lane === "codex" || lane === "claude" || lane === "remote_orchestrator") return "cloud";
  if (lane === "local_control") return "local";
  const scope = status?.endpointScope;
  if (scope === "local") return "local";
  if (scope === "lan") return "lan";
  if (scope === "remote") return "cloud";
  return "unknown";
}

class GraphBuilder {
  readonly nodes = new Map<string, VisionNode>();
  readonly edges = new Map<string, VisionEdge>();

  node(node: VisionNode): void {
    // Eindeutigkeit: eine ID = ein Knoten. Zweite Quelle ergaenzt nur Fakten, ueberschreibt nichts.
    const existing = this.nodes.get(node.id);
    if (!existing) {
      this.nodes.set(node.id, node);
      return;
    }
    const keys = new Set(existing.facts.map((entry) => entry.key));
    existing.facts.push(...node.facts.filter((entry) => !keys.has(entry.key)));
    existing.activity = strongerActivity(existing.activity, node.activity);
  }

  edge(edge: Omit<VisionEdge, "id">): void {
    if (edge.from === edge.to || !this.nodes.has(edge.from) || !this.nodes.has(edge.to)) return;
    const id = edgeId(edge.kind, edge.from, edge.to);
    const existing = this.edges.get(id);
    if (existing) {
      existing.activity = strongerActivity(existing.activity, edge.activity);
      return;
    }
    // Gegenseitige Beziehungen nur einmal (A<->B == B<->A).
    if (edge.direction === "mutual" && this.edges.has(edgeId(edge.kind, edge.to, edge.from))) return;
    this.edges.set(id, { id, ...edge });
  }
}

export function buildVisionGraph(input: VisionGraphInput): VisionGraph {
  const { now } = input;
  const g = new GraphBuilder();
  const omitted: VisionOmission[] = [];
  const jobs = input.nativeRuntime ? input.agentSync?.jobs ?? [] : [];
  const anyActive = jobs.some((job) => ACTIVE_JOB.has(job.status));

  // KatoSync selbst: laeuft nachweislich (diese Projektion wird gerade von ihm berechnet).
  g.node({
    id: HUB_NODE_ID,
    kind: "service",
    label: "KatoSync",
    short: "KS",
    subtitle: "App",
    asset: "katosync",
    scope: "local",
    truth: "verified",
    freshness: "fresh",
    activity: anyActive ? "active" : "ready",
    lastActivityAt: input.agentSync?.generatedAt ?? null,
    source: "katosync",
    facts: [
      ...fact("activeJobs", jobs.filter((job) => ACTIVE_JOB.has(job.status)).length),
      ...fact("projects", input.registry?.projects.length ?? null)
    ]
  });

  // ---- Device / Node identity ----
  const deviceId = input.config?.device.deviceId.trim() ?? "";
  // Eigene Node-ID nur gekuerzt in den Fakten; die Knoten-ID bleibt opak.
  const deviceNodeId = deviceId ? THIS_DEVICE_NODE_ID : null;
  const identities = input.memory?.available ? input.memory.identities : [];
  const rexBoundHere = identities.some((entry) => entry.kind === "rex_main" && entry.nodeId === deviceId);
  if (deviceNodeId) {
    const deviceName = input.config?.device.deviceName.trim() ?? "";
    g.node({
      id: deviceNodeId,
      kind: "device",
      label: deviceName,
      short: deviceName ? initials(deviceName) : "",
      scope: "local",
      truth: "verified",
      freshness: "fresh",
      activity: "ready",
      source: "device_identity",
      facts: [...fact("nodeId", shortNodeId(deviceId)), ...(rexBoundHere ? fact("identity", "rex_main", "code") : [])]
    });
    g.edge({
      kind: "runs_on",
      from: HUB_NODE_ID,
      to: deviceNodeId,
      direction: "directed",
      scope: "local",
      trust: "this_device",
      truth: "verified",
      freshness: "fresh",
      activity: "ready",
      source: "device_identity"
    });
  } else {
    omitted.push("device_identity");
  }
  // Weitere registrierte Node-Identitaeten (Federation-Vorbereitung): bekannt, aber ohne Live-Verbindung.
  for (const identity of identities) {
    if (identity.nodeId === deviceId) continue;
    g.node({
      id: `device:${identity.nodeId}`,
      kind: "device",
      label: identity.displayName,
      short: initials(identity.displayName),
      scope: "unknown",
      truth: "observed",
      freshness: "unknown",
      activity: "unknown",
      source: "memory_fabric",
      facts: [...fact("nodeId", shortNodeId(identity.nodeId)), ...fact("identity", identity.kind, "code")]
    });
  }

  // ---- Projects (Project Registry) ----
  const registry = input.registry;
  if (!registry) omitted.push("project_registry");
  const projectActivity = new Map<string, { activity: VisionActivity; at: string | null }>();
  for (const job of jobs) {
    const project = resolveRegistryProject(registry, job.projectId);
    if (!project) continue;
    const prev = projectActivity.get(project.id);
    const activity = jobActivity(job.status);
    const at = job.lastActivityAt ?? job.startedAt ?? null;
    projectActivity.set(project.id, {
      activity: prev ? strongerActivity(prev.activity, activity) : activity,
      at: [prev?.at, at].filter(Boolean).sort().pop() ?? null
    });
  }
  for (const project of registry?.projects ?? []) {
    const jobState = projectActivity.get(project.id);
    const focusActivity: VisionActivity = project.focus.status === "active" ? "ready" : "idle";
    const activity = jobState && jobState.activity !== "idle" ? jobState.activity : focusActivity;
    const truth = truthFromVerification(project.verification?.state);
    const freshness = projectFreshness(project);
    const nodeId = `project:${project.id}`;
    g.node({
      id: nodeId,
      kind: "project",
      label: project.name,
      short: initials(project.name),
      subtitle: project.scan?.branch ?? null,
      scope: "local",
      truth,
      freshness,
      activity,
      lastActivityAt: jobState?.at ?? project.scan?.headDate ?? project.scan?.scannedAt ?? null,
      source: "project_registry",
      facts: [
        ...fact("branch", project.scan?.branch),
        ...fact("head", shortSha(project.scan?.headSha)),
        ...fact("dirty", project.scan ? project.scan.dirtyCount : null),
        ...fact("focus", project.focus.status, "code"),
        ...fact("priority", project.focus.priority),
        ...fact("verification", project.verification?.state ?? "unscanned", "code"),
        ...fact("scannedAt", project.scan?.scannedAt, "time")
      ]
    });
    g.edge({
      kind: "knows",
      from: HUB_NODE_ID,
      to: nodeId,
      direction: "directed",
      scope: "local",
      trust: "this_device",
      truth,
      freshness,
      activity: activity === "active" ? "active" : "ready",
      source: "project_registry",
      evidence: project.verification?.state ?? "unscanned"
    });
  }

  // ---- Memory Fabric (REX knowledge) ----
  const memory = input.memory;
  if (!memory?.available) {
    omitted.push("memory_fabric");
  } else {
    g.node({
      id: MEMORY_STORE_NODE_ID,
      kind: "service",
      label: "Memory Fabric",
      short: "MF",
      subtitle: "SQLite + FTS5",
      scope: "local",
      truth: "verified",
      freshness: "fresh",
      activity: "ready",
      lastActivityAt: memory.projects.map((entry) => entry.indexedAt).sort().pop() ?? null,
      source: "memory_fabric",
      facts: [
        ...fact("projects", memory.projects.length),
        ...fact("sources", memory.projects.reduce((sum, entry) => sum + entry.sources, 0)),
        ...fact("chunks", memory.projects.reduce((sum, entry) => sum + entry.chunks, 0))
      ]
    });
    g.edge({
      kind: "stores_in",
      from: HUB_NODE_ID,
      to: MEMORY_STORE_NODE_ID,
      direction: "directed",
      scope: "local",
      trust: "this_device",
      truth: "verified",
      freshness: "fresh",
      activity: "ready",
      source: "memory_fabric"
    });
    for (const entry of memory.projects) {
      const project = resolveRegistryProject(registry, entry.projectId);
      const truth = memoryTruth(entry);
      const freshness = memoryFreshness(entry, project);
      const nodeId = `memory:${entry.projectId}`;
      g.node({
        id: nodeId,
        kind: "memory",
        label: project?.name ?? entry.name,
        short: initials(project?.name ?? entry.name),
        subtitle: "Memory",
        scope: "local",
        truth,
        freshness,
        activity: entry.sources > 0 ? "ready" : "idle",
        lastActivityAt: entry.indexedAt,
        source: "memory_fabric",
        facts: [
          ...fact("sources", entry.sources),
          ...fact("chunks", entry.chunks),
          ...fact("truthMix", `${entry.canonical} / ${entry.verified} / ${entry.observed}`),
          ...fact("head", shortSha(entry.gitHead)),
          ...fact("branch", entry.gitBranch),
          ...fact("indexedAt", entry.indexedAt, "time")
        ]
      });
      g.edge({
        kind: "stores_in",
        from: nodeId,
        to: MEMORY_STORE_NODE_ID,
        direction: "directed",
        scope: "local",
        trust: "this_device",
        truth,
        freshness,
        activity: "ready",
        source: "memory_fabric",
        at: entry.indexedAt
      });
      if (project) {
        g.edge({
          kind: "knows",
          from: nodeId,
          to: `project:${project.id}`,
          direction: "directed",
          scope: "local",
          trust: "this_device",
          truth,
          freshness,
          activity: "ready",
          source: "memory_fabric",
          evidence: shortSha(entry.gitHead),
          at: entry.indexedAt
        });
      }
    }
  }

  // ---- Local Brain (REX) ----
  const brain = input.nativeRuntime ? input.localBrain : null;
  const brainPresent = Boolean(brain?.supported && (brain.runtimeInstalled || brain.modelInstalled));
  const brainAlias = brain?.modelAlias.trim() ?? "";
  const localLane = input.agentSync?.lanes.find((lane) => lane.id === "local") ?? null;
  const localLaneIsBrain = brainPresent && Boolean(brainAlias) && localLane?.model === brainAlias;
  if (brain && brainPresent) {
    g.node({
      id: LOCAL_BRAIN_NODE_ID,
      kind: "local_brain",
      // Sichtbare Identitaet des Local Brain ist Kai (wie Live Control); REX bleibt als Identitaets-Fakt.
      label: "Kai",
      short: "KAI",
      subtitle: brain.modelName || null,
      asset: "kai",
      scope: "local",
      truth: brain.running ? "verified" : "observed",
      freshness: "unknown",
      activity: brain.running ? "ready" : "offline",
      source: "local_brain",
      facts: [
        ...(rexBoundHere ? fact("identity", "rex_main", "code") : []),
        ...fact("model", brain.modelName),
        ...fact("runtime", brain.running ? "running" : brain.runtimeInstalled ? "installed" : "not_installed", "code"),
        ...fact(
          "capabilities",
          [brain.textReady && "text", brain.codeReady && "code", brain.toolsReady && "tools", brain.visionReady && "image", brain.audioReady && "audio"]
            .filter(Boolean)
            .join(", ")
        )
      ]
    });
    if (deviceNodeId) {
      g.edge({
        kind: "runs_on",
        from: LOCAL_BRAIN_NODE_ID,
        to: deviceNodeId,
        direction: "directed",
        scope: "local",
        trust: "loopback",
        truth: brain.running ? "verified" : "observed",
        freshness: "unknown",
        activity: brain.running ? "ready" : "offline",
        source: "local_brain",
        evidence: rexBoundHere ? "rex_main" : null
      });
    }
    if (memory?.available) {
      g.edge({
        kind: "retrieves_from",
        from: LOCAL_BRAIN_NODE_ID,
        to: MEMORY_STORE_NODE_ID,
        direction: "directed",
        scope: "local",
        trust: "this_device",
        truth: "verified",
        freshness: "unknown",
        activity: brain.running ? "ready" : "offline",
        source: "memory_fabric"
      });
    }
  } else {
    omitted.push("local_brain");
  }

  // ---- Provider lanes / Local Control / Remote Orchestrator ----
  const lanes = input.nativeRuntime ? input.agentSync?.lanes ?? [] : [];
  if (!input.nativeRuntime || !input.agentSync) omitted.push("agent_lanes");
  for (const lane of lanes) {
    const status = input.providerStatuses.find((entry) => entry.provider === lane.id);
    if (lane.id === "remote_orchestrator" && input.agentSync?.remote.orchestrator === "unavailable") continue;
    if (lane.id === "local_control" && lane.connectivity === "unknown") continue;
    if (lane.kind === "model_provider" && (lane.connectivity === "not_configured" || lane.connectivity === "unknown") && !(lane.id === "local" && localLaneIsBrain)) {
      continue;
    }
    const nodeId = laneNodeId(lane.id, localLaneIsBrain);
    const scope = providerScope(status, lane.id);
    // Der direkte Local-Brain-Status schlaegt einen veralteten Lane-Zustand: gestoppt bleibt gestoppt.
    const activity: VisionActivity = nodeId === LOCAL_BRAIN_NODE_ID && brain && !brain.running ? "offline" : laneActivity(lane);
    const truth = laneTruth(lane);
    const freshness = lane.id === "remote_orchestrator" && input.agentSync?.remote.orchestrator === "stale"
      ? "stale"
      : runtimeFreshness(lane.checkedAt, now);
    const remote = input.agentSync?.remote;
    const kind: VisionNodeKind = lane.kind === "model_provider" ? (nodeId === LOCAL_BRAIN_NODE_ID ? "local_brain" : "model") : "service";
    g.node({
      id: nodeId,
      kind,
      label: LANE_LABEL[lane.id],
      short: lane.id === "local_control" ? "LC" : lane.id === "remote_orchestrator" ? "RO" : initials(LANE_LABEL[lane.id]),
      subtitle: agentLaneDisplayModel(lane),
      // Remote Orchestrator: Marke nur aus veroeffentlichtem Modell, sonst neutral (Initialen).
      asset: agentBrandAsset(agentLaneBrand(lane)),
      scope,
      truth,
      freshness,
      activity,
      lastActivityAt: lane.checkedAt ?? null,
      source: lane.id === "local_control" ? "local_control" : lane.id === "remote_orchestrator" ? "remote_orchestrator" : "agent_lanes",
      facts: [
        ...fact("connectivity", lane.connectivity, "code"),
        ...fact("model", lane.model),
        ...fact("version", status?.version),
        ...fact("auth", status?.authKind && status.authKind !== "unknown" ? status.authKind : null, "code"),
        ...fact("reason", lane.reason, "code"),
        ...fact("currentJob", lane.currentJobId),
        ...fact("rank", lane.kind === "model_provider" ? lane.rank + 1 : null),
        ...(lane.id === "remote_orchestrator" && remote
          ? [
              ...fact("transport", remote.transport, "code"),
              ...fact("ownership", remote.ownership, "code"),
              ...fact("lease", remote.leaseActive ? "lease_active" : "lease_free", "code")
            ]
          : []),
        ...(lane.id === "local_control" ? fact("queue", input.agentSync?.queueCount ?? null) : [])
      ]
    });
    // Routing: KatoSync verteilt Arbeit auf Modell-Lanes und das deterministische Substrat.
    if (lane.id !== "remote_orchestrator") {
      g.edge({
        kind: "routes_to",
        from: HUB_NODE_ID,
        to: nodeId,
        direction: "directed",
        scope,
        trust: scope === "cloud" ? "provider_account" : lane.id === "local_control" ? "this_device" : scope === "local" ? "loopback" : "unknown",
        truth,
        freshness,
        activity: activity === "active" ? "active" : lane.eligible ? "ready" : activity === "offline" ? "offline" : "idle",
        source: "agent_lanes",
        evidence: lane.eligible ? "eligible" : lane.reason ?? null,
        at: lane.checkedAt ?? null
      });
    }
    if (lane.id === "local_control" && deviceNodeId) {
      g.edge({
        kind: "runs_on",
        from: nodeId,
        to: deviceNodeId,
        direction: "directed",
        scope: "local",
        trust: "this_device",
        truth,
        freshness,
        activity: activity === "offline" ? "offline" : "ready",
        source: "local_control"
      });
    }
  }
  // Remote Orchestrator beaufsichtigt ueber Local Control (gegenseitige Heartbeat-/Queue-Beziehung).
  if (g.nodes.has("service:remote_orchestrator") && g.nodes.has("service:local_control") && input.agentSync) {
    const remote = input.agentSync.remote;
    g.edge({
      kind: "connected_to",
      from: "service:remote_orchestrator",
      to: "service:local_control",
      direction: "mutual",
      scope: "cloud",
      trust: "external_supervisor",
      truth: remote.transport === "online" ? "verified" : "observed",
      freshness: remote.orchestrator === "stale" ? "stale" : runtimeFreshness(remote.heartbeatAt, now),
      activity: remote.orchestrator === "working" ? "active" : remote.orchestrator === "stale" ? "waiting" : remote.orchestrator === "detached" ? "offline" : "ready",
      source: "remote_orchestrator",
      evidence: remote.ownership,
      at: remote.heartbeatAt ?? null
    });
  }

  // ---- Arbeit: Lane works_on Projekt (nur echte, nicht abgeschlossene Jobs mit Besitzer) ----
  for (const job of jobs) {
    if (!job.owner || job.status === "completed" || job.status === "failed") continue;
    const project = resolveRegistryProject(registry, job.projectId);
    if (!project) continue;
    const from = laneNodeId(job.owner, localLaneIsBrain);
    g.edge({
      kind: "works_on",
      from,
      to: `project:${project.id}`,
      direction: "directed",
      scope: g.nodes.get(from)?.scope ?? "unknown",
      trust: job.owner === "remote_orchestrator" ? "external_supervisor" : job.owner === "local_control" ? "this_device" : "provider_account",
      truth: "observed",
      freshness: runtimeFreshness(job.lastActivityAt ?? job.startedAt ?? null, now),
      activity: jobActivity(job.status),
      source: "agent_lanes",
      evidence: job.status,
      at: job.lastActivityAt ?? job.startedAt ?? null
    });
  }

  // ---- Mistral Library (Project Memory Uploader) ----
  if (input.config?.libraryId.trim()) {
    g.node({
      id: "service:mistral_library",
      kind: "service",
      label: "Mistral Library",
      short: "ML",
      scope: "cloud",
      truth: input.libraryVerified ? "verified" : "observed",
      freshness: "unknown",
      activity: input.libraryVerified === true ? "ready" : input.libraryVerified === false ? "offline" : "unknown",
      source: "mistral_library",
      facts: fact("configured", "yes", "code")
    });
    g.edge({
      kind: "syncs_with",
      from: HUB_NODE_ID,
      to: "service:mistral_library",
      direction: "directed",
      scope: "cloud",
      trust: "provider_account",
      truth: input.libraryVerified ? "verified" : "observed",
      freshness: "unknown",
      activity: input.libraryVerified === true ? "ready" : "idle",
      source: "mistral_library"
    });
  }

  return {
    schema: VISION_GRAPH_SCHEMA,
    generatedAt: now,
    runtime: input.nativeRuntime ? "desktop" : "browser_preview",
    nodes: [...g.nodes.values()],
    edges: [...g.edges.values()],
    omitted
  };
}

// ===== Filter & Suche =====

export type VisionFilter = "all" | "projects" | "models" | "devices" | "knowledge" | "cloud" | "local";
export const VISION_FILTERS: VisionFilter[] = ["all", "projects", "models", "devices", "knowledge", "cloud", "local"];

export function nodeMatchesFilter(node: VisionNode, filter: VisionFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "projects":
      return node.kind === "project";
    case "models":
      return node.kind === "model" || node.kind === "local_brain";
    case "devices":
      return node.kind === "device" || (node.kind === "service" && node.source !== "memory_fabric");
    case "knowledge":
      return node.kind === "memory" || node.source === "memory_fabric";
    case "cloud":
      return node.scope === "cloud";
    case "local":
      return node.scope === "local" || node.scope === "lan";
  }
}

export interface VisionView {
  nodes: VisionNode[];
  edges: VisionEdge[];
  /** Leere Menge = keine Suche aktiv. */
  matches: Set<string>;
}

/** Filter blendet aus (KatoSync bleibt als Anker sichtbar), Suche hebt hervor statt auszublenden. */
export function filterVisionGraph(graph: VisionGraph, filter: VisionFilter, query: string): VisionView {
  const nodes = graph.nodes.filter((node) => node.id === HUB_NODE_ID || nodeMatchesFilter(node, filter));
  const visible = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));
  const needle = query.trim().toLowerCase();
  const matches = new Set<string>();
  if (needle) {
    for (const node of nodes) {
      const haystack = [node.label, node.short, node.subtitle ?? "", node.kind, ...node.facts.map((entry) => entry.value)]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(needle)) matches.add(node.id);
    }
  }
  return { nodes, edges, matches };
}

// ===== Layout (deterministisch, ohne Physik-Engine) =====

export interface VisionPoint {
  x: number;
  y: number;
  r: number;
}

const INNER_KIND_ORDER: VisionNodeKind[] = ["device", "local_brain", "model", "service"];

/**
 * Konzentrisches Layout um KatoSync: innerer Ring = Systemknoten (Geraete, Brain, Modelle, Dienste),
 * aeusserer Ring = Projekte; Projektwissen sitzt radial hinter seinem Projekt. Gleiche Eingabe -> gleiche Lage.
 * `aspect` (>= 1) streckt die Ringe horizontal zu Ellipsen, damit breite Desktop-Leinwaende genutzt werden.
 */
export function layoutVisionGraph(nodes: VisionNode[], edges: VisionEdge[], aspect = 1): Map<string, VisionPoint> {
  const stretch = Math.min(1.8, Math.max(1, aspect));
  const points = new Map<string, VisionPoint>();
  const hub = nodes.find((node) => node.id === HUB_NODE_ID);
  if (hub) points.set(hub.id, { x: 0, y: 0, r: 34 });

  const inner = nodes
    .filter((node) => node.id !== HUB_NODE_ID && node.kind !== "project" && node.kind !== "memory")
    .sort((a, b) => INNER_KIND_ORDER.indexOf(a.kind) - INNER_KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
  const projects = nodes.filter((node) => node.kind === "project").sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const memories = nodes.filter((node) => node.kind === "memory").sort((a, b) => a.id.localeCompare(b.id));

  const innerRadius = Math.max(140, (inner.length * 80) / (2 * Math.PI * stretch));
  inner.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, inner.length)) * Math.PI * 2;
    points.set(node.id, { x: Math.cos(angle) * innerRadius * stretch, y: Math.sin(angle) * innerRadius, r: node.kind === "local_brain" ? 30 : 26 });
  });

  const outerRadius = Math.max(innerRadius + 140, (projects.length * 70) / (2 * Math.PI * stretch));
  const offset = inner.length > 0 ? Math.PI / Math.max(2, inner.length) : 0;
  projects.forEach((node, index) => {
    const angle = -Math.PI / 2 + offset + (index / Math.max(1, projects.length)) * Math.PI * 2;
    points.set(node.id, { x: Math.cos(angle) * outerRadius * stretch, y: Math.sin(angle) * outerRadius, r: 22 });
  });

  // Projektwissen hinter seinem Projekt; verwaistes Wissen nahe dem Memory-Fabric-Store.
  const knowsTarget = new Map(edges.filter((edge) => edge.kind === "knows" && edge.from.startsWith("memory:")).map((edge) => [edge.from, edge.to]));
  const store = points.get(MEMORY_STORE_NODE_ID) ?? { x: 0, y: innerRadius, r: 26 };
  memories.forEach((node, index) => {
    const project = points.get(knowsTarget.get(node.id) ?? "");
    if (project) {
      const length = Math.hypot(project.x, project.y) || 1;
      points.set(node.id, { x: project.x + (project.x / length) * 72, y: project.y + (project.y / length) * 72, r: 16 });
    } else {
      const angle = (index / Math.max(1, memories.length)) * Math.PI * 2;
      points.set(node.id, { x: store.x * 1.6 + Math.cos(angle) * 70, y: store.y * 1.6 + Math.sin(angle) * 70, r: 16 });
    }
  });
  return points;
}

/** Halbe Breite/Hoehe des belegten Raums (fuer "Einpassen"). */
export function layoutExtent(points: Map<string, VisionPoint>): { x: number; y: number } {
  const extent = { x: 120, y: 120 };
  for (const point of points.values()) {
    extent.x = Math.max(extent.x, Math.abs(point.x) + point.r);
    extent.y = Math.max(extent.y, Math.abs(point.y) + point.r);
  }
  return extent;
}

export function connectedEdges(graph: Pick<VisionGraph, "edges">, nodeId: string): VisionEdge[] {
  return graph.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
}

