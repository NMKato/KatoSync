# KatoSync Local Project Chat — verified Memory Fabric Q&A v1

Date: 2026-10-22. Developer candidate stacked on Continuity PR #95.
NOT deployed. No packaged GUI smoke verified by these code tests.
Separate localhost inference probe verified HTTP 200 health, expected model alias,
and local completion READY_OK in approximately 14 seconds.

## Delivered

Within Agent Sync → Projects & Focus, a selected registered project now has a
local-only Gemma Q&A panel. The interface keeps up to 10 question/answer pairs
in React session state. Switching projects starts a separate empty session.
Every question is independently grounded, not yet a durable multi-turn chat.

The native continuity_local_answer(projectId, question) command accepts no caller
path, URL, model/provider endpoint, API token or tool-call specification.
It opens the existing Memory Fabric database read-only, without DB creation or
schema migration. Persisted Project Registry binding, live Git root and HEAD,
indexed root fingerprint and file-content hashes are checked natively.

FTS5 retrieval is strictly project-scoped; only verified/canonical and fresh
(or unchanged with moved HEAD) evidence is passed into the existing
memory RAG assembler. If no qualifying citations exist, it returns
NOT_IN_MEMORY without invoking an LLM.

With citations, the existing local_brain::grounded_chat path alone performs
generation using the checked, pinned 127.0.0.1:17842 model alias, redirects off,
and a bounded timeout. There is no automatic cloud fallback, paid model call,
new worker service or always-on startup.

Imported Blueprint/journal proposals remain separate from the trusted model RAG.
The UI shows verified citations and live Git HEAD for each answer. The browser
demo cannot invoke native inference. Errors are generic, not raw filesystem paths.
Four existing UI languages DE/EN/ES/RU and existing theme tokens are reused.

## Safety and limitations

- Chat history is in-memory session state and NOT retained after closing the UI.
- Each question is independent; previous messages are displayed but are not
  included as a persistent, trusted model dialogue yet.
- Imported content is untrusted, even if saved to the local journal. Prompts
  do not grant shell, Git, issue, memory promotion, or agent permissions.
- No implementation of mesh, cross-device fenced writer lease or unattended code
  changes; security Issue #76 remains release-blocking.
- No live inference through a packaged Gemma GUI was demonstrated here.
- This does NOT bundle Poppler/Typst, sign installer packages or ship a beta.

## Verification

Local macOS native Rust library: 110 PASS, 3 intentionally ignored.
Node tests: 148 PASS. TypeScript, Vite build, Rust formatting, diff check: PASS.
GitHub Linux/Windows Node + attribution checks must pass separately and do NOT
compile Rust. Full native packaged UI test remains outstanding.

## Next

Live Gemma smoke in the packaged desktop app (online and disconnected);
then durable scoped chat history, context delta and offline resume. After that,
opt-in chat handoff and guarded mesh reconciliation with independent security
review and final UI/UX consistency acceptance.
