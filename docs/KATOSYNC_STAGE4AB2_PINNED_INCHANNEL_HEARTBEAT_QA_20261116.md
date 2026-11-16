# Stage4AB.2 – Authenticated in-channel Mesh heartbeat (isolated QA)

Date: 16 November 2026. Developer: NMKato Solutions. Product: KatoSync.
Base: Stage4AB.1 native durable lease Draft #270, commit d825e9d1a4d89b1f4aa4b874b34e95301030dd7b.

## Goal / existing evidence
- Stage4AA Draft #268 proved physical M2/M3 pinned Ed25519 TLS 1.3 handshakes bidirectionally on two sites, but only once with closed sockets. It never authorized remote tasks.
- Stage4AB.1 Draft #270 already owns the canonical fail-closed in-memory lease and heartbeat state machine.
- Stage4AB Draft #271 separately adds permission-scoped candidate jobs; no actual native execution.
- Stage4AB.2 reuses the one canonical lease engine and adds real application heartbeat frames over an authenticated TLS stream in an isolated QA module.

## New source / isolation
Native module: src-tauri/src/mesh_durable_lease_qa/inchannel_qa.rs, private child of the isolated stage4j-qa module. No Tauri command, public API, CLI, background agent, persistent listener, Cloudflare/Supabase write, client grant or shell/tool dispatch.

A real pinned-TLS channel (using existing strict Ed25519 certificate validation) carries:
1. Verified-owner binding (must be derived from canonical KatoOS session/Keychain by any future native runtime, not from a remote request or model).
2. Fresh 32-byte client nonce, independent fresh 32-byte server nonce, session context hash binding owner and peer.
3. Two strictly sequential authenticated heartbeat frames with fixed-size, bounded framing and transport deadlines.
4. Admission into the existing Stage4AB.1 lease state only while the TLS stream is open; wrong owner, invalid certificate pin, revoked peer or replayed sequence fail closed.
5. Explicit socket close and assertion that Mesh is NOT connected and remote job permissions remain disabled.

Listener setup is confined to genuine loopback-TCP Rust test fixtures at 127.0.0.1 ephemeral ports. New native macOS CI workflow will compile and run pinned-TLS positive and negative tests. Four Node source contract tests cover visibility, authentication, protocol and no-deploy policy.

## What a PASS proves
- Node QA PASS: only static contract, NOT runtime or hardware.
- Native Cargo QA PASS: actual pinned-TLS socket + owner-bound application heartbeats on a loopback test socket, NOT installed cross-site KatoSync.
- Historical Stage4AA PASS: exact Keychain-authenticated one-shot cross-site mTLS, NOT a durable session.
- No verified RC66 owner/client/device/project grant or signed native job, and no automatic KatoSync MCP device access.

## Still required for real M3 -> M2 read-only Git job
1. Security-review Rust code; native macOS CI and Apple signing/notarization after gated release.
2. Wire an independent trusted native producer using live owner session, approved public key, current enrollment and revocation watch into an actual existing open TLS socket.
3. Implement bounded persistent supervision: authenticated heartbeat, reconnect, sleep/wake, cancel, one-device emergency revoke and no forged connected status.
4. Combine owner-approved RC66 grants/step-up with Stage4AB #271 task candidate, Stage4L registered-project Git executor, exact project HEAD, one-time signed idempotent task and bounded receipt. An actual Git process is never authorized by TLS alone.
5. Test physical M2↔M3 over two internet sites, positive and wrong-owner/wrong-key/replay/offline/revocation negative cases; then Windows parity.
6. Only after signed native device QA may ChatGPT KatoSync MCP expose controlled read-only tools. Terminal/files/GUI Computer Use remain separate owner-granted gates.

No existing Stage4AA bundle overwritten, no prod deployment, database changes or real remote shell.
Release: QA Draft / NO-GO for executing real device jobs.

References:
https://github.com/NMKato/KatoSync/pull/268
https://github.com/NMKato/KatoSync/pull/270
https://github.com/NMKato/KatoSync/pull/271
https://github.com/NMKato/KatoSync/issues/241
