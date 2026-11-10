# Stage4N – M2/M3 Operator-Switch-Preflight (QA only)

Date: 2026-11-10, Berlin. Signer build source HEAD 20b3076.
This QA documentation/script does not modify the signed application.

## Read-only hardware preflight

Both real Apple Silicon Macs independently passed the same QA preflight:
- notarized Apple Developer-ID candidate signature, Gatekeeper and exact signed binary SHA-256
  7ebbf887b9df8dd8143493ec6be6dcd2777e1797f441747ede7c3e79ae5c0958;
- exactly one expected running older Stage4J instance;
- empty inbox and running job directories, no active lanes or currentJobId;
- no competing local KatoSync model listener at 127.0.0.1:17842.

Run:
    bash scripts/qa-stage4n-owner-switch-preflight.sh M2
or transfer the exact QA script to M3:
    bash qa-stage4n-owner-switch-preflight.sh M3

The only output authorization is READY_FOR_HUMAN_REVIEW_ONLY.
The script never performs a process kill, app launch, file deletion, Keychain read,
credential collection, registration write or peer approval.

## Remaining required owner operations

1. On M2 and M3 save all open documents and unsaved GUI/editor inputs.
2. On each device explicitly confirm fresh server-verified owner sign-in.
   A local email marker or stale roster does not prove authentication.
3. With an explicitly approved per-device handoff, quit the exact old QA
   process gracefully and then open the signed Stage4N candidate once.
   Stage4J and Stage4N share app, singleton and Keychain identifiers:
   launching both in parallel is forbidden. Keep the prior signed binary
   for rollback; no production installation or implicit migration.
4. Use the Mesh connection guide and account device directory in the
   actual running app; reject ambiguous or revoked entries. Perform
   a fresh bidirectional signed challenge, manually compare the SAS
   across both Macs, and approve the exact other device in person.
5. A local public-key pin alone does not imply transport. Verify the
   native mTLS peer and signed owner enrollment with real keys, then
   reconnect/revoke/restart, then one explicitly authorized read-only job
   and a durable matching result receipt.
6. For travel: independent remote-network accessibility via a protected
   relay or KatoSync MCP path is necessary. LAN-only hardware QA does not
   establish reachability from outside the owner's home.

No new features; focus is integration and beta launch gates.
No auto-merge, production deploy, live Mesh remote jobs or public beta.

Decision: TWO_MAC_OWNER_SWITCH_PREFLIGHT_PASS;
OWNER_AUTH_AND_HUMAN_SAS_REQUIRED; MESH_REMOTE_JOBS_DISABLED.

Created by NMKato Solutions
