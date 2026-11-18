# REX Memory Fabric v1

KatoSync uses one local, inspectable knowledge fabric so Local Brain, subscription providers and the Remote Orchestrator can continue from verified project truth instead of rediscovering context.

## Identity blueprint

- REX is the fixed name of the first/main Local Brain.
- The existing persistent KatoSync device ID (ks-UUID) is the immutable technical Node ID.
- Display names never grant permissions, own leases, identify writers, or replace audit IDs.
- Additional nodes/agents may self-select one short modern name of 4-6 letters.
- REX is reserved and cannot be selected by another node.
- A self-selected name is bound to its Node ID and cannot be silently changed by the model.
- Persona metadata is bounded and secret/path redacted.
- Personality is derived from approved role, capabilities and verified experience references; model guesses never become canonical truth automatically.

## Memory truth

The canonical technical store is local SQLite + FTS5. Markdown/Obsidian is an inspectable projection only.

Truth levels:
1. observed - seen locally but not proven by Git/human evidence.
2. verified - matches the committed Git/content state.
3. canonical - explicitly promoted with evidence and bound to the exact content hash.

A changed or missing source becomes stale. A moved HEAD is surfaced separately.

## Ingestion

Ingestion is project scoped and allowlist based. It reuses Project Registry / Context Pack source rules and never recursively indexes the user's home directory.

Supported knowledge includes status, handoff, memory, architecture, roadmap, ADR and agent guidance documents.

Excluded by default:
- env files, credentials, keys, certificates and known secret filenames
- secret-shaped content
- build/cache/vendor directories
- absolute machine paths in stored/output text
- symlinks/paths escaping the project boundary
- oversized or unsupported sources

## Retrieval and RAG

Retrieval is project scoped.

Pipeline:

Project truth -> SQLite/FTS5 -> ranked verified chunks -> bounded RAG block -> REX/Local Brain

Ranking combines lexical relevance, truth level and freshness. A semantic/embedding reranker is an adapter seam, not the source of truth.

Default assembled RAG blocks include only verified/canonical non-stale content and are bounded to protect smaller local models.

If no verified context matches, KatoSync returns NOT_IN_MEMORY without asking the model to guess.

## Local Brain fast path

The managed Gemma Local Brain runs only on the pinned loopback endpoint and exact kato-local-brain model alias.

For grounded factual RAG answers KatoSync disables unnecessary thinking with the llama.cpp template flag chat_template_kwargs.enable_thinking=false.

This keeps factual retrieval fast and token efficient. More expensive local reasoning can be enabled later for task classes that actually need it.

The live acceptance gate verifies both:
- a fact present only in verified Memory Fabric context is answered correctly;
- a missing fact returns NOT_IN_MEMORY.

## Vision overview

The Vision system graph (`docs/VISION.md`) reads only a counts-based, read-only overview (`memory_fabric_overview`): per-project source/chunk counts, truth-level mix, stored HEAD and index time, plus registered node identities. It never returns content or paths and never creates the store.

## Obsidian

Obsidian/Markdown is a generated human view of structured memory.

- projections are never silently read back as canonical truth;
- edited projections are preserved rather than overwriting the store;
- changes must enter through source documents or explicit evidence-backed promotion.

## Next slices

1. UI wiring for indexing/search/REX grounded chat.
2. Node/persona projection into the Obsidian view.
3. Local multilingual embedding model benchmark.
4. Hybrid FTS + vector reranking.
5. Episodic Experience Memory with evidence promotion.
6. Fleet/federated retrieval between trusted nodes.
7. R2-distributed Local Brain package/update channel.

(Created by NMKato Solutions)

## KatoSync 4.0 — Agent Birth memory contract (planned, 2026-11-04)

The mesh device cryptographic identity and a model-backed **agent persona** are distinct entities. The fingerprint-derived KAI device display names currently used by Stage 3.5 are temporary technical aliases, **not LLM-selected names or evidence of an awake agent**. A local persona is activated only after a verified local model/runtime inference, an owner-confirmed initial name and durable local persistence. Names are never authorization or identity credentials.

The existing **REX** name remains reserved for the established main Local Brain. New agents may choose unique short names after activation; stable persona IDs and the pinned device public keys do not change when the displayed name is edited. A model's self-description must never silently rewrite canonical project memory.

Memory ownership is layered:
- **Per-device:** OS-keychain Ed25519 identity, current capability evidence, runtime/model versions and revocation metadata; never share private keys.
- **Per-agent:** owner-approved persona name, role, lifecycle state, approved tool permissions and bounded local episodic history. Dormant agents remain identifiable without a running LLM.
- **Per-project:** existing SQLite/FTS5 Memory Fabric with verified/canonical evidence, explicit source provenance, stale-HEAD checks and owner-controlled project scope.
- **Per-mesh:** transport only minimal public capabilities and explicitly approved project summaries after mutual SAS/key pin and authenticated TLS. No automatic chat history, credentials, filesystem paths, system prompts or private memory replication.

The **Birth transaction** must be idempotent after crashes, reversible before approval, testable offline and recoverable across upgrades. Tool results are untrusted observations until confirmed and scoped to a project. Security gates, consent and server-side entitlement remain mandatory independently of any model-generated text. Auto-introductions are allowed only after verified mutual trust and secure transport, with replay/expiry and single-delivery protection.

**Release status:** This contract is a KatoSync **4.0 target**, not implemented behavior of the current Stage 3.5 QA apps. See `docs/KATOSYNC_4_0_AGENT_BIRTH_RELEASE_ROADMAP_2026-11-04.md` for acceptance gates, M2/M3 local-model prerequisites, OpenClaw adapter review and real two-device testing.
