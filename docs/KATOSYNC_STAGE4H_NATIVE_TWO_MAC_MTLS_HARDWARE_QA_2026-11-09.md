# Stage4H: Native Rust mTLS — physical M2 ↔ M3 acceptance (synthetic test keys)

**Date:** 2026-11-09, Europe/Berlin
**Original source:** `NMKato/KatoSync`, Draft PR #247, parent SHA `9b2be64767b3983bb0e3b48246c1a98575450e83`.

## What was actually tested

**Real physical macOS hosts**, not an isolated mocked network:

| Machine | Local name | Private-LAN IP | Role |
| --- | --- | --- | --- |
| M2 Apple Silicon | `4gi.tv` | `192.168.178.97` | Client, then reverse-direction server |
| M3 Apple Silicon | `nmk` | `192.168.178.162` | Server, then reverse-direction client |

- M2 compiled the **current, exact GitHub SHA** from an isolated Git worktree with `cargo test --offline --locked --features katoos-auth-qa --lib --no-run` and the existing M2 Cargo target cache. `tsc && vite build` passed. Synthetic `.test-only` resource placeholders were used **for native test compilation only**, **not** for packaging, installation, customer delivery or release.
- Resulting native `arm64` macOS Rust lib test executable `katosync_lib-385dd29a9da36ffd`: 36 MB; file SHA-256 **`4285b1a9e6c595db15c310c52d00957f8bb01ec3acc274da4c5a23f14e88d0c4`**.
- M2 local Rust Mesh transport tests: **6 passed**, zero failed, one manually guarded two-host test ignored (until explicit hardware execution). Includes actual `127.0.0.1` TCP mutual TLS roundtrip, wrong/unknown pinned cert denial, invalid frame rejection, malformed response nonce and timeout.
- M3 has **no installed Rust/Cargo toolchain**. We transferred **only the 36 MB synthetic QA executable** on private LAN via a one-shot M2-only read-only HTTP endpoint, restricted to the M3 source IP and exact file path. M3 independently verified the **identical SHA-256** and macOS linker ad-hoc signature. The transfer used no production credentials, keys, profiles or K2S data. The one-shot transfer listener was confirmed closed.
- Native test function `mesh_transport::tests::manual_two_host_private_lan_pinned_tls_probe` was run directly from this **same validated Rust test executable** on both physical Macs with `--ignored --exact --nocapture --test-threads=1`. Test guard demands `KATOSYNC_MESH_LAN_QA_ALLOW=SYNTHETIC_FIXTURES_ONLY`, exact RFC1918 IP/peer, unprivileged one-shot port and strictly bounded test duration.
- **Positive A: M3 server, M2 client, TCP `192.168.178.162:49334`:** M2 1 passed/0 failed, M3 1 passed/0 failed. The actual native `mesh_transport::client_probe` and `server_probe` validated **TLS 1.3 mutual Ed25519 identity pins** and the nonce echo. Both test processes completed successfully (exit 0).
- **Negative B: M3 server, M2 client with deliberately WRONG certificate pin, TCP `192.168.178.162:49335`:** Both passed their **expected-denial** assertions (exit 0). Client refused the certificate binding; server did not accept a successful mutual TLS session. This is an actual network negative test, not merely a unit assertion.
- **Positive C, reversed network roles: M2 server, M3 client, TCP `192.168.178.97:49336`:** Both passed (exit 0), confirming the native transport roundtrip in both physical directions. The test has fixed fixture identities by client/server role (Ed25519 seeds 41 and 42), **not** unique persistent machine-bound device IDs.
- **No cloud, no production writes:** No Supabase SQL/migration, Auth, Edge call, billing action, Mesh remote job, user device permission or modified installed application. `main` unmerged.

## Security claims and limits

**Proved on hardware:** Rust-native pinned **mutual** TLS 1.3 with actual sockets and bidirectional encrypted 40-byte challenge/echo; failures for deliberately mismatched approved peer identity; explicit private-LAN role and socket guards. No insecure fallback and no remote-execution capability was activated.

**Not proved:** production M2/M3 Keychain/secure-vault keys, human SAS confirmation, owner-session and registered-device binding, long-running service/reconnection, signed device enrollment in shared K2S, real revocation and replay across sessions, Cloud/Mesh sync, worktree writer leases, source/agent takeover or read-only remote-job receipts. The persistent app's `verifiedPeers` remains unproven; the test asserts `remoteReadOnlyDispatch=false` and `crossDeviceWrites=false`. Existing notarized Stage35 QA apps are older and were not replaced.

**Important:** The original test's synthetically derived Ed25519 keys are shared only within this controlled QA executable; public knowledge of the fixture means it **cannot** be used to authorize real user devices or for any production Mesh transport.

## Next P0 gates — ordered plan

1. **Identity and SAS:** Use separate M2 and M3 device keys from each machine's OS-protected key storage (never export a private key), validate signed public identity and owner/account binding, present matching short-authentication strings (SAS) and require explicit owner confirmation. A trust receipt must be scoped to exact device fingerprint, account, epoch and peer.
2. **Connect to native app:** Route the already tested native TLS probe into a strictly read-only, manually triggered UI connection check. Refuse ambiguous devices, wrong or revoked key, stale owner session or device identity swap. On failure keep `paired=false`, `transportReady=false`, `remoteJobsEnabled=false`.
3. **Reliability/security:** Test restart/reconnect, Sleep/airplane/offline, repeated or replayed handshake, key rotation, device revocation and loss of authenticated session. Maintain exact terminal state and truthfully display errors/refresh.
4. **First job:** With explicit owner approval and independent per-project lease/fencing, allow only one signed **read-only** M2↔M3 job and verify complete receipt, timeout/retry, deduplication, cancel, audit and no remote writes/merges/deploys.
5. **Windows:** Add third node only after the two-Mac trust lifecycle and signed/notarized macOS release QA are proven; complete Windows-signing and QA separately.

The verified native mTLS hardware proof **closes the synthetic transport-test subgate only**, not the overall P0 Mesh pairing or beta release gate. No new paid staging project is required.
