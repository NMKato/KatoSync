# KatoSync Mesh — Stage4V truthful local pairing status (QA)

Created by NMKato Solutions
Date: 2026-11-11
Base: qa/stage4u-mesh-relay-scheduler-20261111 @ aac8e34eff1eeed50f066abd5b008ad303751d2b

## Verified facts from physical M2/M3 test

- A real invitation (prefix d411dee8) was accepted on 11 November 2026.
- Exactly one signed Challenge from M3 to M2 and one signed Response from M2 to M3 were saved under the same request.
- Both running Stage4U applications displayed "Geräteschlüssel sicher bestätigt".
- Both local macOS Keychains contain an account-scoped approved-public-pins record. No private key contents were read.
- The present client does NOT run a native Mesh listener and the host checks found no KatoSync TCP listener.
- Therefore the correct facts are locally approved public keys, no active authenticated Mesh tunnel, no remote job authorization.

## Bug

The original mesh_local_readiness QA protocol intentionally and safely hardcoded device_identity=not_paired and peer_transport=not_connected. However, the human-facing UI reused the legacy "not paired" display despite a later, separately owner-confirmed pin. Following a restart the in-memory easyStage=approved does not persist, so even a successful persisted pin could be misrepresented.

## Stage4V solution (source-only QA, not yet installed)

1. Leave the original signed native readiness security contract unchanged. It continues to deny any connected-peer or remote-access assertion.
2. During explicit status refresh, issue an account-verified, read-only native Keychain inventory request through the existing mesh_local_approved_peers command. Never invoke any pairing/approval/write command from a refresh.
3. Reject an invalid native response (wrong scope/approval-only flag, transport or job rights unexpectedly enabled, invalid pin status/fingerprint, excessive entries). Use checking, never guessed trust.
4. Derive local pairing from an exact approved public-key fingerprint matching an active registered non-self device in the same current owner-scoped roster. No cross-owner, self or revoked devices.
5. Clear all previous Keychain-derived status whenever a new refresh or reauthentication starts; reject late results via a monotonic per-view operation guard.
6. Make the GUI distinguish Gekoppelt (lokal) from Verbunden; the subtitle explicitly states that the secure network link is not active, even when the new local pairing indicator is shown.
7. Restore the accurate local pairing indication after restarting the QA app, provided the native read and current roster verification succeed.
8. Keep agent greeting and cross-device job actions blocked until a separately authenticated live tunnel actually exists; no granting of new scope, no production rollout.

## Native transport: separate Stage4W acceptance gate

The existing mesh_tls.rs restricts TLS 1.3, Ed25519 mTLS, X25519 key exchange and AES-256-GCM. mesh_transport.rs already implements a synthetic one-shot fixed-frame client/server probe and a manually ignored two-host LAN test. It is not a listener or continuously authenticated tunnel.

Next implementation must not infer transport from an HTTP relay, signed invite, stored pin or general LAN TCP reachability. Required:
- Secure per-device native listener with explicit narrow QA enablement, no general port exposure, owner-scope Keychain admission checks and current revocation checks on both ends.
- Out-of-band authenticated certificate/endpoint exchange bound to the existing Ed25519 pin, not untrusted UI strings or arbitrary self-signed certificates.
- Local/private network and strict peer source controls; bounded timeouts, single-active-channel policy and meaningful expiry/liveness heartbeat with actual TLS peer proof.
- Explicit positive and negative physical two-host tests, then reboot and revocation verification.
- Remote dispatch stays disabled. A separate, conscious owner grant and read-only job QA are mandatory to enable work.
- Only after all of these checks may the UI present Verbunden.

## Evidence

- Stage4V deterministic status tests: 6/6 PASS, including cross-account, self, revoked, wrong pin, absent inventory, unsupported transport, fail-closed and restart-derived labels.
- Inherited Stage4S security regression: 28/28 PASS.
- Additional build/CI results must be appended after verification.

NO MERGE TO MAIN / NO PROD / NO AUTOMATIC OWNER TRUST / NO REMOTE EXECUTION.
