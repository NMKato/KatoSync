# Continuity Blueprint – user-driven preview UI (stacked draft)

Date: 2026-10-22. Depends on the read-only parser contract of PR #91.
No production release or Memory Fabric write in this change.

## User interaction

The existing Agent Sync > Projects & Focus screen now contains a Continuity Blueprint
panel, visually aligned with existing glass cards and theme tokens.

- Choose one exact registered project from canonical Project Registry.
- Paste blueprint JSON or choose a local .json file (32 KiB maximum).
- Click "Review locally" to validate against the selected registered project ID.
- Display title, intent, source, imported baseline SHA, reason WHY decisions were made,
  alternatives, consequences, evidence references and proposed next steps.
- Import remains ephemeral React component state. Changing projects resets input/preview.
- The file picker only reads local content after explicit user selection, with no upload.
- No automatic execution, approvals, memory promotion, localStorage, Git modification,
  outgoing HTTP, model invocation, cloud-worker activation, or background task starts.

## Security

The project is chosen from the registered project list, not guessed from file content.
The JSON contract rejects foreign project IDs and embedded approval fields.
The UI does NOT claim that a cached Registry HEAD equals live Git HEAD:
it deliberately passes null for currentGitHead and displays "fresh native check pending".
No stale Git state is promoted by the UI; actual native fresh preflight is a later slice.
All displayed imported content is React text (HTML escaped), never raw HTML.
Raw imported payload and parser exceptions are not logged.

The implementation reuses existing DE/EN/ES/RU localization and CSS tokens, with
responsive project cards; final holistic design audit happens at release gate.

## Verification

- Local Node 22: npm test = 143/143 PASS, including the 7 parser security tests.
- npm run typecheck = PASS.
- npm run build = PASS (existing chunk-size warning only).
- git diff --check = PASS.
- GitHub Linux / Windows / attribution workflows must pass on this exact branch.
- Native packaged GUI and accessibility walkthrough still pending.

## Follow-up

Next native slice: conflict-aware, explicit, owner-approved persistence into the
existing Memory Fabric, with validated fresh Git HEAD and idempotent offline event
journal. No autonomous code writes until Issue #76 is independently reviewed
and enforced in the real native runner.

Cost operations note: no warm cloud workers are used or started by this preview.
Infrastructure spending policy is internal to our development, not an end-user
KatoSync feature.
