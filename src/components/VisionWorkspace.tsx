// Created by NMKato Solutions
// Vision v1: visueller Systemgraph ("Freiraum"-Stil) unter der Agent-Sync-Uebersicht.
// Reine View: Graph, Filter und Suche kommen aus useVisionViewModel / lib/visionGraph.ts.
// Klick auf Knoten oder Kante oeffnet EINE angeheftete, schwebende Karte mit Fakten – keine Aktionen,
// keine Seiteneffekte. Zoom/Pan ueber SVG-Transform, ruhige Bewegung, reduced motion respektiert.
// Nicht zu verwechseln mit der spaeteren multimodalen "Sight"-Runtime.
import {
  Bot,
  BrainCircuit,
  Database,
  FolderGit2,
  Laptop,
  Locate,
  Minus,
  Plus,
  RefreshCcw,
  Search,
  Server,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useT, type TFunc, type TKey } from "../i18n";
import { AGENT_BRAND_ASSET_SRC } from "../lib/agentLanePresentation";
import {
  HUB_NODE_ID,
  VISION_FILTERS,
  connectedEdges,
  layoutExtent,
  layoutVisionGraph,
  type VisionAsset,
  type VisionEdge,
  type VisionFact,
  type VisionGraph,
  type VisionNode,
  type VisionNodeKind,
  type VisionPoint
} from "../lib/visionGraph";
import { useVisionViewModel } from "../viewmodels/useVisionViewModel";
import type { useKatoSyncViewModel } from "../viewmodels/useKatoSyncViewModel";

type ViewModel = ReturnType<typeof useKatoSyncViewModel>;
type Selection = { type: "node" | "edge"; id: string } | null;
type CardPosition = { left: number; top: number; side: "left" | "right"; maxHeight: number };
interface Transform {
  x: number;
  y: number;
  k: number;
}

// Eine Markenwahrheit fuer Live Control und Vision (keine zweite Provider-Map).
const ASSET_SRC: Record<VisionAsset, string> = AGENT_BRAND_ASSET_SRC;

const KIND_ICON: Record<VisionNodeKind, typeof Bot> = {
  project: FolderGit2,
  model: Bot,
  local_brain: BrainCircuit,
  device: Laptop,
  memory: Database,
  service: Server
};

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.6;
const CARD_WIDTH = 300;

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Uebersetzt einen Code, faellt auf den Rohwert zurueck, wenn es keinen Text gibt. */
function codeText(t: TFunc, prefix: string, code: string): string {
  const key = `${prefix}.${code}` as TKey;
  const text = t(key);
  return text === key ? code : text;
}

function nodeLabel(t: TFunc, node: VisionNode | undefined): string {
  if (!node) return "—";
  return node.label || t("vision.node.thisDevice");
}

function hashOf(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function relativeTime(value: string | null | undefined, lang: string): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  const seconds = Math.round((at - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86_400), "day");
}

interface EdgeGeometry {
  path: string;
  mid: { x: number; y: number };
}

/** Leicht gebogene Kante zwischen den Kreisraendern (deterministische Kruemmung). */
function edgeGeometry(edge: VisionEdge, from: VisionPoint, to: VisionPoint): EdgeGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const bend = (hashOf(edge.id) % 2 === 0 ? 1 : -1) * Math.min(48, length * 0.12);
  const cx = (from.x + to.x) / 2 - uy * bend;
  const cy = (from.y + to.y) / 2 + ux * bend;
  const start = { x: from.x + ux * (from.r + 6), y: from.y + uy * (from.r + 6) };
  const end = { x: to.x - ux * (to.r + 8), y: to.y - uy * (to.r + 8) };
  return {
    path: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    mid: { x: 0.25 * start.x + 0.5 * cx + 0.25 * end.x, y: 0.25 * start.y + 0.5 * cy + 0.25 * end.y }
  };
}

export function VisionWorkspace({ vm }: { vm: ViewModel }) {
  const { t } = useT();
  const vision = useVisionViewModel(vm);
  const { graph, view } = vision;

  return (
    <section className="vision-page" id="section-agent-vision">
      <div className="vision-toolbar glass">
        <p className="vision-intro">{t("vision.intro")}</p>
        <div className="vision-controls">
          <div className="vision-filters" role="radiogroup" aria-label={t("vision.filter.label")}>
            {VISION_FILTERS.map((filter) => (
              <button
                aria-checked={vision.filter === filter}
                className={vision.filter === filter ? "active" : ""}
                key={filter}
                onClick={() => vision.setFilter(filter)}
                role="radio"
                type="button"
              >
                {t(`vision.filter.${filter}` as TKey)}
              </button>
            ))}
          </div>
          <label className="vision-search">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label={t("vision.search.label")}
              onChange={(event) => vision.setQuery(event.target.value)}
              placeholder={t("vision.search.placeholder")}
              type="search"
              value={vision.query}
            />
          </label>
          <button
            className="ghost compact-button"
            disabled={vision.loading}
            onClick={() => void vision.refresh()}
            title={t("vision.refresh.title")}
            type="button"
          >
            <RefreshCcw className={vision.loading ? "spin" : ""} size={15} />
            <span>{t("vision.refresh")}</span>
          </button>
        </div>
      </div>

      <VisionCanvas graph={graph} nodes={view.nodes} edges={view.edges} matches={view.matches} query={vision.query} />

      <footer className="vision-footer">
        <span>{t("vision.count", { nodes: view.nodes.length, edges: view.edges.length })}</span>
        {graph.runtime === "browser_preview" ? <span className="vision-note">{t("vision.preview")}</span> : null}
        {vision.memoryFailed ? <span className="vision-note warn">{t("vision.memoryFailed")}</span> : null}
        {graph.omitted.length > 0 ? (
          <span className="vision-omitted">
            {t("vision.omitted.title")}{" "}
            {graph.omitted.map((entry) => (
              <em key={entry}>{t(`vision.omitted.${entry}` as TKey)}</em>
            ))}
          </span>
        ) : null}
      </footer>
    </section>
  );
}

function VisionCanvas({
  graph,
  nodes,
  edges,
  matches,
  query
}: {
  graph: VisionGraph;
  nodes: VisionNode[];
  edges: VisionEdge[];
  matches: Set<string>;
  query: string;
}) {
  const { t, lang } = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<Transform | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  // Layout ueber den GANZEN Graphen: Filter blenden aus, ohne dass Knoten springen.
  // Seitenverhaeltnis nur grob (Stufen), damit Resize das Layout nicht staendig neu berechnet.
  const aspect = size.height ? Math.round((size.width / size.height) * 4) / 4 : 1;
  const points = useMemo(() => layoutVisionGraph(graph.nodes, graph.edges, aspect), [graph.nodes, graph.edges, aspect]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const visibleIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const geometry = useMemo(() => {
    const map = new Map<string, EdgeGeometry>();
    for (const edge of edges) {
      const from = points.get(edge.from);
      const to = points.get(edge.to);
      if (from && to) map.set(edge.id, edgeGeometry(edge, from, to));
    }
    return map;
  }, [edges, points]);

  const fit = useCallback((): Transform | null => {
    if (!size.width || !size.height) return null;
    const extent = layoutExtent(points);
    // Labels/Untertitel unter den Knoten brauchen unten etwas mehr Luft.
    const k = clampZoom(Math.min(1.25, size.width / (2 * (extent.x + 70)), size.height / (2 * (extent.y + 50))));
    return { x: size.width / 2, y: size.height / 2, k };
  }, [points, size]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Einpassen, sobald die Groesse bekannt ist und wenn sich Seitenverhaeltnis-Stufe oder Knotenzahl aendern.
  // Live-Ticks mit gleicher Struktur behalten Zoom/Pan des Nutzers.
  const fitKey = `${aspect}|${graph.nodes.length}`;
  const lastFitKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastFitKey.current === fitKey) return;
    const next = fit();
    if (!next) return;
    lastFitKey.current = fitKey;
    setTransform(next);
  }, [fit, fitKey]);

  // Auswahl verwerfen, wenn das Ziel ausgefiltert wurde oder aus der Quelle verschwunden ist.
  useEffect(() => {
    if (!selection) return;
    const stillVisible = selection.type === "node" ? visibleIds.has(selection.id) : edges.some((edge) => edge.id === selection.id);
    if (!stillVisible) setSelection(null);
  }, [edges, selection, visibleIds]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setTransform((current) => {
      if (!current) return current;
      const k = clampZoom(current.k * factor);
      const ratio = k / current.k;
      return { k, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
    });
  }, []);

  // Wheel braucht einen nicht-passiven Listener, sonst scrollt die Seite mit.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!transform || event.button !== 0) return;
    if ((event.target as Element).closest(".vision-node, .vision-edge-hit, .vision-card, .vision-zoom")) return;
    drag.current = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.moved = true;
    if (state.moved) setTransform((current) => (current ? { ...current, x: state.tx + dx, y: state.ty + dy } : current));
  };
  const onPointerUp = () => {
    const state = drag.current;
    drag.current = null;
    // Klick ins Leere schliesst die Karte (Freiraum-Verhalten).
    if (state && !state.moved) setSelection(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") setSelection(null);
    else if ((event.key === "+" || event.key === "=") && !isTyping(event)) zoomAt(1.2, size.width / 2, size.height / 2);
    else if (event.key === "-" && !isTyping(event)) zoomAt(1 / 1.2, size.width / 2, size.height / 2);
  };

  const select = (next: Selection) => setSelection((current) => (current && next && current.type === next.type && current.id === next.id ? null : next));
  const activate = (next: Selection) => (event: ReactKeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(next);
    }
  };

  const searching = query.trim().length > 0;
  const selectedNode = selection?.type === "node" ? nodeById.get(selection.id) : undefined;
  const selectedEdge = selection?.type === "edge" ? edges.find((edge) => edge.id === selection.id) : undefined;
  const highlighted = useMemo(() => {
    const ids = new Set<string>();
    if (selectedNode) {
      ids.add(selectedNode.id);
      for (const edge of connectedEdges({ edges }, selectedNode.id)) {
        ids.add(edge.id);
        ids.add(edge.from);
        ids.add(edge.to);
      }
    }
    if (selectedEdge) [selectedEdge.id, selectedEdge.from, selectedEdge.to].forEach((id) => ids.add(id));
    return ids;
  }, [edges, selectedEdge, selectedNode]);
  const focusMode = highlighted.size > 0;

  // Bildschirmanker der offenen Karte (folgt Zoom/Pan).
  let anchor: { x: number; y: number; r: number } | null = null;
  if (transform && selectedNode) {
    const point = points.get(selectedNode.id);
    if (point) anchor = { x: transform.x + point.x * transform.k, y: transform.y + point.y * transform.k, r: point.r * transform.k };
  } else if (transform && selectedEdge) {
    const geo = geometry.get(selectedEdge.id);
    if (geo) anchor = { x: transform.x + geo.mid.x * transform.k, y: transform.y + geo.mid.y * transform.k, r: 6 };
  }
  let card: CardPosition | null = null;
  if (anchor && size.width) {
    const rightLeft = anchor.x + anchor.r + 22;
    const side = rightLeft + CARD_WIDTH <= size.width - 12 || anchor.x < size.width / 2 ? "right" : "left";
    const left = side === "right" ? Math.min(rightLeft, size.width - CARD_WIDTH - 12) : Math.max(12, anchor.x - anchor.r - 22 - CARD_WIDTH);
    // Karte bleibt vollstaendig in der Leinwand; lange Inhalte scrollen innerhalb der Karte.
    const top = Math.max(12, Math.min(anchor.y - 48, size.height - 360));
    card = { left: Math.max(12, left), top, side, maxHeight: Math.max(160, Math.min(480, size.height - top - 12)) };
  }

  return (
    <div
      aria-label={t("vision.canvas.label")}
      className="vision-canvas"
      onKeyDown={onKeyDown}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      ref={containerRef}
      role="application"
    >
      <div aria-hidden="true" className="vision-starfield" />
      {transform ? (
        <svg className="vision-svg" height={size.height} width={size.width}>
          <defs>
            <marker id="vision-arrow" markerHeight="7" markerWidth="7" orient="auto-start-reverse" refX="6" refY="3.5" viewBox="0 0 7 7">
              <path d="M0,0 L7,3.5 L0,7 z" />
            </marker>
            <radialGradient id="vision-core" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
            </radialGradient>
          </defs>
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            <g className="vision-edges">
              {edges.map((edge) => {
                const geo = geometry.get(edge.id);
                if (!geo) return null;
                const from = nodeById.get(edge.from);
                const to = nodeById.get(edge.to);
                const dim = (focusMode && !highlighted.has(edge.id)) || (searching && !matches.has(edge.from) && !matches.has(edge.to));
                const target: Selection = { type: "edge", id: edge.id };
                return (
                  <g
                    className={`vision-edge kind-${edge.kind} act-${edge.activity} fresh-${edge.freshness}${dim ? " dim" : ""}${selectedEdge?.id === edge.id ? " selected" : ""}`}
                    key={edge.id}
                  >
                    <path className="vision-edge-line" d={geo.path} markerEnd="url(#vision-arrow)" markerStart={edge.direction === "mutual" ? "url(#vision-arrow)" : undefined} />
                    {edge.activity === "active" ? <path className="vision-edge-flow" d={geo.path} /> : null}
                    <path
                      aria-label={t(`vision.edge.${edge.kind}.sentence` as TKey, { from: nodeLabel(t, from), to: nodeLabel(t, to) })}
                      className="vision-edge-hit"
                      d={geo.path}
                      onClick={() => select(target)}
                      onKeyDown={activate(target)}
                      role="button"
                      tabIndex={0}
                    />
                  </g>
                );
              })}
            </g>
            <g className="vision-nodes">
              {nodes.map((node) => {
                const point = points.get(node.id);
                if (!point) return null;
                const dim = (focusMode && !highlighted.has(node.id)) || (searching && !matches.has(node.id));
                const target: Selection = { type: "node", id: node.id };
                return (
                  <VisionNodeGlyph
                    dim={dim}
                    key={node.id}
                    label={nodeLabel(t, node)}
                    match={searching && matches.has(node.id)}
                    node={node}
                    onActivate={activate(target)}
                    onSelect={() => select(target)}
                    point={point}
                    selected={selectedNode?.id === node.id}
                    ariaLabel={`${nodeLabel(t, node)} · ${t(`vision.kind.${node.kind}` as TKey)} · ${t(`vision.act.${node.activity}` as TKey)}`}
                  />
                );
              })}
            </g>
          </g>
          {anchor && card ? (
            <line
              className="vision-card-leader"
              x1={anchor.x + (card.side === "right" ? anchor.r + 4 : -anchor.r - 4)}
              x2={card.side === "right" ? card.left : card.left + CARD_WIDTH}
              y1={anchor.y}
              y2={card.top + 30}
            />
          ) : null}
        </svg>
      ) : null}

      {searching && matches.size === 0 ? <div className="vision-empty">{t("vision.search.empty")}</div> : null}

      {card && selectedNode ? (
        <NodeCard
          graph={graph}
          lang={lang}
          node={selectedNode}
          nodeById={nodeById}
          onClose={() => setSelection(null)}
          onSelect={select}
          position={card}
          visibleEdges={edges}
        />
      ) : null}
      {card && selectedEdge ? (
        <EdgeCard edge={selectedEdge} lang={lang} nodeById={nodeById} onClose={() => setSelection(null)} onSelect={select} position={card} />
      ) : null}

      <div className="vision-zoom">
        <button aria-label={t("vision.zoomIn")} onClick={() => zoomAt(1.2, size.width / 2, size.height / 2)} title={t("vision.zoomIn")} type="button">
          <Plus size={15} />
        </button>
        <button aria-label={t("vision.zoomOut")} onClick={() => zoomAt(1 / 1.2, size.width / 2, size.height / 2)} title={t("vision.zoomOut")} type="button">
          <Minus size={15} />
        </button>
        <button aria-label={t("vision.fit")} onClick={() => setTransform(fit())} title={t("vision.fit")} type="button">
          <Locate size={15} />
        </button>
      </div>

      <div aria-hidden="true" className="vision-legend">
        <span className="legend-active">{t("vision.act.active")}</span>
        <span className="legend-ready">{t("vision.act.ready")}</span>
        <span className="legend-stale">{t("vision.legend.dimmed")}</span>
        <span className="legend-truth">{t("vision.legend.truth")}</span>
      </div>
    </div>
  );
}

function isTyping(event: ReactKeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

function VisionNodeGlyph({
  node,
  point,
  label,
  ariaLabel,
  dim,
  match,
  selected,
  onSelect,
  onActivate
}: {
  node: VisionNode;
  point: VisionPoint;
  label: string;
  ariaLabel: string;
  dim: boolean;
  match: boolean;
  selected: boolean;
  onSelect: () => void;
  onActivate: (event: ReactKeyboardEvent) => void;
}) {
  const { r } = point;
  const delay = `${-(hashOf(node.id) % 9000)}ms`;
  const muted = node.activity === "offline" || node.freshness === "stale";
  const Icon = KIND_ICON[node.kind];
  const short = node.short || (node.kind === "device" ? "◎" : "?");
  return (
    <g
      aria-label={ariaLabel}
      className={[
        "vision-node",
        `kind-${node.kind}`,
        `act-${node.activity}`,
        `truth-${node.truth}`,
        muted ? "muted" : "",
        dim ? "dim" : "",
        match ? "match" : "",
        selected ? "selected" : "",
        node.id === HUB_NODE_ID ? "hub" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onSelect}
      onKeyDown={onActivate}
      role="button"
      tabIndex={0}
      transform={`translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`}
    >
      <g className="vision-node-float" style={{ animationDelay: delay }}>
        {node.activity === "active" ? <circle className="vision-node-pulse" r={r + 6} /> : null}
        <circle className="vision-node-halo" r={r + 12} />
        <circle className="vision-node-core" r={r} />
        <circle className="vision-node-sheen" fill="url(#vision-core)" r={r} />
        <circle className="vision-node-ring" r={r + 3.5} />
        {node.asset ? (
          <image
            className="vision-node-asset"
            height={r * 1.45}
            href={ASSET_SRC[node.asset]}
            preserveAspectRatio="xMidYMid meet"
            width={r * 1.45}
            x={-r * 0.725}
            y={-r * 0.725}
          />
        ) : (
          <text className="vision-node-initials" dominantBaseline="central" textAnchor="middle" style={{ fontSize: Math.max(10, r * (short.length > 2 ? 0.5 : 0.62)) }}>
            {short}
          </text>
        )}
        <g className="vision-node-badge" transform={`translate(${(r * 0.72).toFixed(1)} ${(r * 0.72).toFixed(1)})`}>
          <circle r={8.5} />
          <Icon height={10} width={10} x={-5} y={-5} />
        </g>
        <text className="vision-node-label" textAnchor="middle" y={r + 19}>
          {label}
        </text>
        {node.subtitle ? (
          <text className="vision-node-sub" textAnchor="middle" y={r + 32}>
            {node.subtitle}
          </text>
        ) : null}
      </g>
    </g>
  );
}

function StateChips({ truth, freshness, activity, scope, t }: { truth: string; freshness: string; activity: string; scope: string; t: TFunc }) {
  return (
    <div className="vision-chips">
      <span className={`vision-chip act-${activity}`}>{t(`vision.act.${activity}` as TKey)}</span>
      <span className={`vision-chip truth-${truth}`} title={t("vision.card.truth")}>
        {t(`vision.truth.${truth}` as TKey)}
      </span>
      <span className={`vision-chip fresh-${freshness}`} title={t("vision.card.freshness")}>
        {t(`vision.fresh.${freshness}` as TKey)}
      </span>
      <span className="vision-chip scope" title={t("vision.card.scope")}>
        {t(`vision.scope.${scope}` as TKey)}
      </span>
    </div>
  );
}

function factValue(t: TFunc, entry: VisionFact, lang: string): string {
  if (entry.format === "code") return codeText(t, "vision.code", entry.value);
  if (entry.format === "time") {
    const date = new Date(entry.value);
    return Number.isNaN(date.getTime()) ? entry.value : `${date.toLocaleString(lang, { dateStyle: "short", timeStyle: "short" })}`;
  }
  return entry.value;
}

function CardShell({
  position,
  title,
  kicker,
  icon,
  onClose,
  children,
  labelledBy
}: {
  position: CardPosition;
  title: string;
  kicker: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy: string;
}) {
  const { t } = useT();
  return (
    <aside
      aria-labelledby={labelledBy}
      className={`vision-card side-${position.side}`}
      role="dialog"
      style={{ left: position.left, top: position.top, width: CARD_WIDTH, maxHeight: position.maxHeight }}
    >
      <header>
        <span className="vision-card-icon">{icon}</span>
        <div>
          <small>{kicker}</small>
          <strong id={labelledBy}>{title}</strong>
        </div>
        <button aria-label={t("vision.card.close")} className="vision-card-close" onClick={onClose} title={t("vision.card.close")} type="button">
          <X size={15} />
        </button>
      </header>
      {children}
    </aside>
  );
}

function NodeCard({
  node,
  graph,
  visibleEdges,
  nodeById,
  position,
  lang,
  onClose,
  onSelect
}: {
  node: VisionNode;
  graph: VisionGraph;
  visibleEdges: VisionEdge[];
  nodeById: Map<string, VisionNode>;
  position: CardPosition;
  lang: string;
  onClose: () => void;
  onSelect: (selection: Selection) => void;
}) {
  const { t } = useT();
  const Icon = KIND_ICON[node.kind];
  const links = connectedEdges(graph, node.id);
  const visible = new Set(visibleEdges.map((edge) => edge.id));
  const last = relativeTime(node.lastActivityAt, lang);
  return (
    <CardShell
      icon={node.asset ? <img alt="" src={ASSET_SRC[node.asset]} /> : <Icon size={16} />}
      kicker={t(`vision.kind.${node.kind}` as TKey)}
      labelledBy={`vision-card-${hashOf(node.id)}`}
      onClose={onClose}
      position={position}
      title={nodeLabel(t, node)}
    >
      {node.subtitle ? <p className="vision-card-sub">{node.subtitle}</p> : null}
      <StateChips activity={node.activity} freshness={node.freshness} scope={node.scope} t={t} truth={node.truth} />
      <dl className="vision-facts">
        {node.facts.map((entry) => (
          <div key={entry.key}>
            <dt>{t(`vision.fact.${entry.key}` as TKey)}</dt>
            <dd>{factValue(t, entry, lang)}</dd>
          </div>
        ))}
        {last ? (
          <div>
            <dt>{t("vision.card.lastActivity")}</dt>
            <dd>{last}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("vision.card.source")}</dt>
          <dd>{t(`vision.source.${node.source}` as TKey)}</dd>
        </div>
      </dl>
      <h4>{t("vision.card.connections")}</h4>
      {links.length === 0 ? (
        <p className="vision-card-empty">{t("vision.card.noConnections")}</p>
      ) : (
        <ul className="vision-links">
          {links.map((edge) => {
            const otherId = edge.from === node.id ? edge.to : edge.from;
            const outgoing = edge.from === node.id;
            return (
              <li key={edge.id}>
                <button
                  className={`act-${edge.activity}`}
                  disabled={!visible.has(edge.id)}
                  onClick={() => onSelect({ type: "edge", id: edge.id })}
                  type="button"
                >
                  <span className="vision-link-kind">{t(`vision.edge.${edge.kind}` as TKey)}</span>
                  <span aria-hidden="true">{edge.direction === "mutual" ? "↔" : outgoing ? "→" : "←"}</span>
                  <span className="vision-link-target">{nodeLabel(t, nodeById.get(otherId))}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
}

function EdgeCard({
  edge,
  nodeById,
  position,
  lang,
  onClose,
  onSelect
}: {
  edge: VisionEdge;
  nodeById: Map<string, VisionNode>;
  position: CardPosition;
  lang: string;
  onClose: () => void;
  onSelect: (selection: Selection) => void;
}) {
  const { t } = useT();
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  const at = relativeTime(edge.at, lang);
  return (
    <CardShell
      icon={<span className="vision-card-glyph">{edge.direction === "mutual" ? "↔" : "→"}</span>}
      kicker={t("vision.card.relationship")}
      labelledBy={`vision-card-${hashOf(edge.id)}`}
      onClose={onClose}
      position={position}
      title={t(`vision.edge.${edge.kind}` as TKey)}
    >
      <p className="vision-card-sentence">{t(`vision.edge.${edge.kind}.sentence` as TKey, { from: nodeLabel(t, from), to: nodeLabel(t, to) })}</p>
      <div className="vision-endpoints">
        <button onClick={() => onSelect({ type: "node", id: edge.from })} type="button">
          {nodeLabel(t, from)}
        </button>
        <span aria-hidden="true">{edge.direction === "mutual" ? "↔" : "→"}</span>
        <button onClick={() => onSelect({ type: "node", id: edge.to })} type="button">
          {nodeLabel(t, to)}
        </button>
      </div>
      <StateChips activity={edge.activity} freshness={edge.freshness} scope={edge.scope} t={t} truth={edge.truth} />
      <dl className="vision-facts">
        <div>
          <dt>{t("vision.card.direction")}</dt>
          <dd>{t(`vision.direction.${edge.direction}` as TKey)}</dd>
        </div>
        <div>
          <dt>{t("vision.card.trust")}</dt>
          <dd>{t(`vision.trust.${edge.trust}` as TKey)}</dd>
        </div>
        {edge.evidence ? (
          <div>
            <dt>{t("vision.card.evidence")}</dt>
            <dd>{codeText(t, "vision.code", edge.evidence)}</dd>
          </div>
        ) : null}
        {at ? (
          <div>
            <dt>{t("vision.card.lastActivity")}</dt>
            <dd>{at}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("vision.card.source")}</dt>
          <dd>{t(`vision.source.${edge.source}` as TKey)}</dd>
        </div>
      </dl>
    </CardShell>
  );
}
