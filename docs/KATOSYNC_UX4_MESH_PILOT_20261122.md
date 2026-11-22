# UX4 Mesh pilot: signed presence and explicit pairing configuration

Created by NMKato Solutions. Date: 2026-11-22.

## Fixed integration gap

The previous UX4 AccountMeshProvider read the account roster every minute but did not invoke the existing signed device-presence command. The older MeshConnectionCard already had that lifecycle. A running UX4 window could therefore leave its enrolled identity's last-seen timestamp stale.

AccountMeshPresence restores the existing behavior behind `VITE_STAGE35_HEARTBEAT_QA=1`. It runs only for the exact registered, non-revoked local identity, serializes calls, respects the bounded server poll interval and backs off after failure. Account changes and disposal invalidate in-flight results; React StrictMode creates a fresh lifecycle after cleanup. It does not enroll an identity, update UI timestamps optimistically, approve a peer, start transport or grant remote jobs. Native owner, session, signature, enrollment and revocation checks remain authoritative.

## Explicit pilot build

The existing read-only builder remains unchanged. `scripts/build-ux4-mesh-pilot-macos.sh` builds the same composite `ux4-mesh-qa` feature with sender, receiver, relay and signed presence enabled. It requires `KATOSYNC_UX4_PAIRING_PILOT=1`, an exact current `KATOSYNC_UX4_PAIRING_EXPECT_SHA`, a clean tracked source tree and isolated external build directories. `--check` validates configuration without compiling or launching. A node_modules symlink is refused before dependency installation so another checkout is not modified.

The script builds only; it does not install, launch, sign/notarize, copy credentials, deploy backend configuration, register devices or approve trust. Both physical devices still need the corresponding server gates and separately verified native authorization. A manifest records the build source and enabled paths without private machine paths or credentials.

## Source verification

- Six behavior tests cover registration/opt-in, single in-flight call, server polling bounds, retry backoff, malformed/authority-claiming receipts, account switches and disposal/remount.
- The combined presence, account onboarding and UX4 composition/disabled-invitation suites pass 32 tests.
- TypeScript check and Bash syntax check pass.
- This is source verification, not native two-device acceptance.

## Native acceptance sequence

1. Confirm the exact built candidate visibly starts, and the existing saved account remains usable.
2. For an already enrolled identity, observe a new signed presence timestamp in the account-scoped backend. Confirm that no device enrollment, invitation, peer trust or remote job was created by the heartbeat.
3. On both physical devices, use the existing connection flow; verify the signed exchange and both matching comparison codes. Complete the actual explicit peer review on each device.
4. Verify fresh mutually bound transport status, stop/start and reconnect. A recent cloud last-seen timestamp alone never counts as connected.
5. Run a separately authorized, project-bound read-only job and compare its result independently. Client/device grants and MFA remain a separate MCP acceptance gate.

## RACK, Memory Fabric and local model acceptance

Use a disposable committed Git project with README, MEMORY, RACK and PROJECT_STATUS_FLOW documents. Register it through the existing project picker; do not edit the registry or SQLite directly. In the selected project's local chat, inspect diagnostics and use the explicit backup/index refresh action if needed. Existing native commands are `continuity_chat_diagnostics`, `continuity_chat_repair_project`, `continuity_chat_history` and `continuity_chat_send`; the UI binds them to the registered project.

Ask for a fact present only in the fixture, verify the answer and citations against the committed document, and verify that an absent fact returns NOT_IN_MEMORY. Change a known fixture source and verify that stale content is not returned as fresh; then use the normal index refresh. Check that chat history persists after reopening, RACK-style context capsules identify the correct project/status, and an explicit projection export preserves pre-existing edited files.

The rolling archive projector remains a separate synthetic, read-only component. These checks do not establish live cross-device journal replication or an automatic archive writer. Evidence must name the exact tested command/path and distinguish source contracts from observed native outcomes.
