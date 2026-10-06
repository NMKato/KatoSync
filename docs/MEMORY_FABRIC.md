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
