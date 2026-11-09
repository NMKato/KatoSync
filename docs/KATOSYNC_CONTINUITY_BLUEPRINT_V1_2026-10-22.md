# KatoSync Continuity Blueprint v1 — isolated import contract

Date: 2026-10-22. **Development draft / contract only. Not a deployed chat, sync service, or approved agent executor.**

## Product intent

Keep the **reason why** a change was made, not just the Git diff. KatoSync remains the
canonical Project Registry and Memory Fabric. A ChatGPT/Claude/local-Gemma session may
export a **user-authorized structured Blueprint** with architectural choices,
alternatives, rationale, consequences, project identity and evidence references.
The KatoSync app will eventually preview and reconcile that data offline.

This slice adds a pure, bounded **read-only import/compare core**, with no new database
and no claim that Remote Desktop Commander already exports conversations.

## Contract and trust boundary

- Import JSON schema: katosync.continuity-blueprint/v1.
- The caller MUST provide registered project ID from the verified Project Registry and
  a fresh Git HEAD from native preflight. Neither value may be taken from the imported JSON.
- A different project ID fails closed. A different HEAD is visibly marked stale, not
  silently mapped or merged. Unknown HEAD is visibly marked unknown.
- The importer accepts only explicit fields, bounded UTF-8 payload and arrays, safe IDs,
  known evidence types and GitHub/opaque evidence references. It redacts common secret
  patterns as defense in depth; raw imported content is still **untrusted**.
- Decision rationale is retained as *data*. An imported claim is **never a model system
  instruction, verified project policy, executable job, owner approval or canonical ADR**.
  Every imported decision is labelled proposed, even when a provider claims otherwise.
- The comparison helper reports changes to the same decision's choice/rationale but does
  not resolve or persist them automatically. Existing canonical decisions cannot be
  overwritten by this helper.
- No provider/API calls, file writes, localStorage, network requests, Git mutation,
  installation, cloud sync, human authorization or tool execution in this module.

## Example input

~~~json
{
  "schemaVersion": "katosync.continuity-blueprint/v1",
  "projectId": "katosync",
  "blueprintId": "continuity-engine",
  "revision": 1,
  "title": "Offline continuity",
  "intent": "Carry approved project reasoning between chats and offline devices.",
  "source": {
    "kind": "chat_handoff",
    "label": "Human-approved ChatGPT handoff",
    "capturedAt": "2026-10-22T08:00:00Z",
    "reference": null
  },
  "baseGitHead": null,
  "decisions": [
    {
      "id": "ADR-001",
      "title": "Reuse existing Memory Fabric",
      "choice": "Store verified knowledge via the existing Fabric, not a new store.",
      "rationale": "Preserve a single source of truth and offline availability.",
      "alternatives": ["Duplicate context in a new chat database"],
      "consequences": ["New previews must link back to verified source records"],
      "evidence": [{"kind": "pull_request", "ref": "https://github.com/NMKato/KatoSync/pull/75"}]
    }
  ],
  "nextSteps": ["Build user-confirmed import UI"]
}
~~~

## Acceptance of this slice

Run: node --experimental-strip-types --test tests/continuityBlueprint.test.ts

Full project npm test, npm run typecheck, npm run build, GitHub Linux/Windows
PR Fast Gate and attribution policy are independent gates. No app release claim.

## Next gated slices (NOT implemented here)

1. UI: select a registered project, import JSON, inspect rationale/evidence/HEAD
   drift, explicitly approve or reject candidate decisions (no silent promotion).
2. Native offline, append-only event journal with atomic durable writes, idempotency
   keys, private data at rest, transaction/version checks; integrate existing Memory
   Fabric rather than making another truth store.
3. Native context delta and offline chat resume using the installed Gemma model,
   with explicit distinction between model-generated statements and verified facts.
4. Opt-in ChatGPT/Claude MCP handoff; no automatic access to their private conversations;
   owner decides which context may leave a device. Reconcile GitHub PR/issue/CI evidence
   with live fetch when online and with staleness labels offline.
5. Mesh conflict-aware handoff using device IDs, monotonic event sequencing and
   verified base/head SHAs. Before ANY writer integration, close safety Issue #76:
   real authenticated approvals, fenced distributed one-writer lease, isolated
   worktrees, lost-lease cancellation and multi-device failure testing.
6. Final consistent UI/UX, accessibility and full macOS/Windows installer acceptance.

Designed to preserve KatoOS beta work separately from KatoSync release engineering.
