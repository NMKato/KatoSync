# KatoSync Vision v1: visual system graph

Vision is a page under **Agent Sync → Overview** (nav step `agentVision`). It shows the KatoSync system as a calm, zoomable graph, so people without a technical background can see what exists, how the parts relate, and how reliable each statement is.

> **Vision ≠ Sight.** Vision is the *visual system/knowledge graph*. A future multimodal "Sight / Vision Runtime" (image/audio understanding by a local model) is a separate capability. It will get its own name, code path and documentation and must not reuse the `vision*` modules described here.

## Architecture

```
Existing sources of truth (unchanged)           Projection (pure)              View
───────────────────────────────────────         ────────────────────           ─────────────────────
Project Registry (projects, scan, verification) ┐
Agent Sync state (lanes, jobs, remote, LC)      │
Provider status (version, auth kind, scope)     ├─► buildVisionGraph() ─► VisionGraph ─► VisionWorkspace (SVG)
Local Brain status                              │   src/lib/visionGraph.ts            Freiraum cards
Device config (persistent ks-UUID, name)        │                                     filters / search
Memory Fabric overview (read-only counts) ──────┘
```

- `src/lib/visionGraph.ts`: provider-neutral types plus the pure projection, filter, search and deterministic layout. It doesn't do I/O and doesn't store anything.
- `src/viewmodels/useVisionViewModel.ts`: builds the projection from the existing KatoSync view model. Its only own read is the Memory Fabric overview.
- `src/components/VisionWorkspace.tsx`: the SVG rendering, pan/zoom and the floating cards.
- `memory_fabric_overview` (Rust, `src-tauri/src/memory_fabric/overview.rs`): opens the existing SQLite store **read-only**, and only if it already exists. It never creates a store. It returns per-project counts (sources, chunks, observed/verified/canonical), the stored HEAD/branch, the index time and registered node identities (ID, display name, kind). It never returns content, chunks, source paths, evidence text or persona details.

Vision doesn't introduce a second source of truth. The graph is recomputed from the sources on every state change and never persisted.

### Graph model (`katosync.vision-graph/v1`)

| Node kind | Source | Example |
|---|---|---|
| `project` | Project Registry | registered repositories |
| `model` | Agent Sync lanes + provider status | Codex, Claude, a non-managed local model |
| `local_brain` | Local Brain status (+ local lane if it *is* the managed brain) | REX (KAI mark) |
| `device` | persistent device ID / registered node identities | this device, other named nodes |
| `memory` | Memory Fabric overview | per-project knowledge |
| `service` | KatoSync, Memory Fabric store, Local Control, Remote Orchestrator, Mistral Library | |

| Edge kind | Meaning | Example |
|---|---|---|
| `knows` | holds knowledge about | KatoSync → project (registry), project memory → project |
| `works_on` | a lane owns a non-terminal job | Claude → project |
| `retrieves_from` | grounded retrieval | REX → Memory Fabric |
| `runs_on` | executes on | KatoSync / REX / Local Control → this device |
| `syncs_with` | synchronises | KatoSync → Mistral Library |
| `routes_to` | can hand work to | KatoSync → provider lanes / Local Control |
| `stores_in` | persists into | project memory → Memory Fabric |
| `connected_to` | supervision/transport link (mutual) | Remote Orchestrator ↔ Local Control |

Every node and edge carries:

- **truth**: `canonical | verified | observed | unknown`, the same vocabulary as the Memory Fabric.
  - Projects: `verified` only when the registry verification state is `verified`. Any other finding is `observed`. Unscanned projects are `unknown`.
  - Project memory: the best level present (the full canonical/verified/observed mix is shown on the card).
  - Lanes: `verified` when KatoSync has its own check timestamp, `observed` for a merely reported state, `unknown` without connectivity information.
- **freshness**: `fresh | head_moved | stale | unknown`.
  - Projects: compares the verification HEAD with the scanned HEAD. `status_stale` maps to `stale`.
  - Memory: compares the indexed HEAD with the registry's scanned HEAD. v1 doesn't probe content hashes live, so `fresh` means "HEAD unchanged".
  - Runtime: a check or heartbeat counts as fresh for 15 minutes.
- **activity**: `active | ready | idle | waiting | blocked | offline | unknown`.
- **scope** (`local | lan | cloud | unknown`). Edges also carry **direction** (`directed | mutual`) and **trust** (`this_device | loopback | provider_account | external_supervisor | unknown`).

Uniqueness: one ID is one node. A second source for the same ID adds facts but never overwrites existing ones; for example, the local lane merges into the Local Brain node when it serves the managed brain alias. Edge IDs are `kind:from->to`, and a mutual edge exists only once. Edges are only created when both endpoints exist.

### No invented nodes

- A missing source is omitted and listed under "Not shown (source unavailable)" (`graph.omitted`).
- Jobs whose project isn't in the registry produce no node and no edge.
- Lanes that are `not_configured`/`unknown` and an `unavailable` Remote Orchestrator aren't drawn.
- In the browser preview, provider statuses are demo values, so lanes, the Local Brain and work edges are not projected there.
- The "REX" label is only used when a `rex_main` identity is bound to *this* device's node ID. Otherwise the node is called "Local Brain".

## Freiraum interaction

- Dark cyber/space canvas with floating glass nodes. Active nodes pulse gently and active edges show a slow flow. Ready nodes stay calm. Offline/stale nodes are dimmed. The ring style shows reliability (solid = verified/canonical, dashed = observed, dotted = unknown).
- Identity: approved local assets are used where they exist (`katoos_icon_logo_trans.png` for KatoSync, `kai-ai-icon.png` for the Local Brain/REX). Every other node shows initials plus a small kind badge.
- Clicking a node opens **one** floating card attached to it (with a leader line). The card lists status, type, truth, freshness, scope, facts, last activity, source and connections. Clicking a connection in the card opens the relationship card.
- Clicking an edge opens a relationship card at the edge midpoint. It shows a plain-language sentence ("REX retrieves verified knowledge from Memory Fabric"), the endpoints, direction, trust boundary, evidence code, truth, freshness and last activity.
- Cards close via ×, Escape, a click on empty space, or by clicking the same element again. Cards contain **no actions and trigger no side effects**. "Refresh" only re-reads the read-only overview.
- Drag pans, the mouse wheel zooms around the cursor, `+`/`-` and the buttons zoom, and ⌖ re-fits the graph. Nodes and edges are keyboard focusable (Enter/Space).
- Filters: all / projects / models / devices & services / knowledge / cloud / local. Filters hide nodes (KatoSync stays as the anchor). Text search highlights matches and dims the rest. The layout is computed on the full graph, so filtering never makes nodes jump.
- `prefers-reduced-motion`: floating, pulse, edge flow, starfield drift and card entrance animations are disabled.
- No new dependency: plain React + SVG with a deterministic concentric layout. The rings are stretched to ellipses on wide desktop canvases.

## Security boundaries

- No secrets, tokens, API keys or library IDs appear in nodes, edges or cards. Provider data is limited to what the redacted `ProviderStatus` already exposes (version, auth *kind*, endpoint *scope*), never endpoints.
- No absolute machine paths. Project roots, worktree paths, log paths, commands and control roots aren't projected. Node IDs are shown shortened, and this device's node uses the opaque graph ID `device:self`.
- The Memory Fabric overview is read-only (`SQLITE_OPEN_READ_ONLY`), returns counts only, and returns "unavailable" instead of creating a store.
- Vision is purely observational. It doesn't start jobs, take leases, change provider routing or touch the one-writer rules of Local Control / the Remote Orchestrator. Display names never grant rights.
- Tests (`tests/visionGraph.test.ts`, the Rust `overview_is_read_only_counts_only_and_never_creates_a_store`) cover projection truth, omission, uniqueness, truth/freshness mapping, filters, layout determinism and the absence of paths/endpoints/secrets.

## Future: federation and multi-node

- Other registered node identities (self-selected names, see `docs/MEMORY_FABRIC.md`) already appear as `device` nodes with `unknown` activity and no live edges. v1 doesn't invent connectivity it can't prove.
- Next slices:
  1. live node heartbeats from trusted nodes become `syncs_with`/`connected_to` edges with `verified` truth;
  2. federated retrieval between trusted nodes becomes cross-node `retrieves_from` edges with an explicit trust scope;
  3. live content-hash staleness for project memory;
  4. per-node views (a node's own graph) and time travel over evidence.
- Federation must keep the same rules: one ID per entity, identity bound to the persistent node ID, read-only projection, and no secrets/paths crossing node boundaries.

(Created by NMKato Solutions)
