# Stage4AB.3.2B – echte Netzwerk-, Sleep/Wake- und Widerrufstests (Vorbereitung)

**Repository:** NMKato/KatoSync  
**Parent:** Stage4AB.3.2A Draft #278 (Commit `d714a3d1ead497029f8525ebdc88f5f0f2f21f91`)  
**Branch:** `qa/stage4ab32b-fault-gates-20261116`  
**Scope:** QA-only; no merge, signing, installation, hardware fault injection or production promotion from this PR.

## What is implemented in this checkpoint

- Internal Rust **simulated** fault classifier and new-session prerequisite model, isolated behind the existing `stage4j-qa` feature. Not wired to the real supervisor, Tauri IPC or app runtime.
- Three permitted bounded attempt delays (2/4/8 seconds) only for modeled link loss and sleep/wake **and only after** every simulated owner/Keychain/dual-enrollment/consent/network preflight flag is true. A later production design must supply independently VERIFIED native proofs; boolean test fixtures are not trusted authorization.
- Revoke, owner switch, pin/certificate mismatch, heartbeat replay and unknown errors are terminal; 3 failed attempts or elapsed deadline stop further attempts.
- Synthetic old-live-lease invalidation tests use the canonical `LiveTlsLease` methods. Separate checks reject reuse of the previous session nonce or any missing fresh mTLS / preflight / first heartbeat evidence.
- A Node contract verifies negative cases and keeps this module free of CLI, Tauri commands, OS/network manipulation and remote jobs. A dedicated macOS CI workflow compiles and executes Rust tests without signing or deploying.

This is **NOT** completion of the physical Stage4AB.3.2B acceptance. The original Stage4AB.3.2A proof still applies only to a server-side TLS stream drop.

## Physical acceptance matrix – OPEN, not yet executed

| Case | Start condition | Expected evidence | Stop/rollback |
| --- | --- | --- | --- |
| A: M3 Server / M2 Client link down | Already mutually authenticated real TLS session, first verified heartbeat | Real OS network link change detected from independent device-local monitoring; old lease invalid immediately; no stale “connected” UI; after link restoration a **new** pinned TLS1.3 + fresh nonces + owner/Keychain/both enrollment checks + three heartbeats | Use a test-only network interface or pre-authorized noncritical network path; preserve local console fallback; never sever the sole management channel |
| B: M2 Server / M3 Client link down | As above, reversed | Same fail-closed behavior, independent timestamps and signed build hashes on both Macs | Same rollback and fallback |
| C: M2 sleep then wake | Test-only idle channel; explicit local owner approval | Lease invalid on sleep, no false presence, after wake full new authentication; blocked if KatoOS owner invalid | Local wake path preserved; no remote-only wake automation |
| D: M3 sleep then wake | As above, reversed | Same; no stale session or accidental parallel listener | Local wake path preserved |
| E: Device/enrollment revoked mid-session | **Nonproduction isolated enrollment fixture and credentials**, never the real owner pair | Existing stream/lease goes terminal; no retry; no remote jobs; explicit reset needed before re-enrollment | Fixture reset with audit and independent evidence |
| F: Owner switch, invalid pin, replay | Synthetic and where safe isolated hardware cases | Terminal denial; no retry or downgrade; no proof from overlay/Bonjour/device-inventory | No mutation of real Keychain or tenant registration |
| G: Post-test cleanup | After every individual attempt | Zero listener/established QA socket/test process, expected binary hash and no production state change | Stop isolated process; restore manually controlled test interface or QA fixture |

### Prior approval and security checks for any later hardware run

1. Two local devices reachable by a **separate, unaffected recovery path**; local owner confirmation immediately before any real interface or sleep change. If not independently recoverable: **SKIP**, do not emulate a success.
2. Freeze exact QA commit, green native CI, matching binary checksums, Apple Developer-ID notarization/verification on both hosts. Keep prior QA binaries untouched.
3. Tests run locally with least privilege and an explicit bounded timeout. Preserve exclusive SingleQaPermit and the existing five QA opt-ins; **a sixth opt-in and a dedicated code path require a separate review before hardware control**.
4. No operating-system network control is included in this PR; no live KatoOS owner/keychain/token changes, no remote CLI, no filesystem access, no daemon, no RC65 capability.
5. Record only non-sensitive fault classes, monotonic elapsed timings, process exit codes, state transitions and hashed artifact IDs. Never log tokens, account IDs, certificate private material or direct host identifiers.
6. Review abort behavior, denial on stale owner/grants, duplicate attempts, deadline exhaustion, and genuine proof of a new authenticated live channel before signing off Stage4AB.3.2B.

## Gate status

- [x] Read existing Stage4AB.3.2A source and roadmap
- [x] Add isolated simulated fail-closed retry/reauth policy and source security contracts
- [ ] Native macOS CI PASS for exact new QA commit
- [ ] Independent security review
- [ ] Approve and implement real physical test-only fault harness
- [ ] Signed + notarized identical QA binaries
- [ ] Physical bidirectional network loss PASS
- [ ] Physical bidirectional sleep/wake PASS
- [ ] Isolated in-flight enrollment/consent revocation PASS
- [ ] Cleanup, audit and truthful UI transition checks PASS
- [ ] Separately review always-on supervisor and relay transport

**Do not merge this stacked PR to main. Keep all production and remote-device authority disabled.**

## Native macOS passive OS-event observation – QA-only checkpoint

The bounded Objective-C observer `scripts/qa-stage4ab32b-macos-os-events.m`
subscribes to macOS `NSWorkspaceWillSleepNotification` and
`NSWorkspaceDidWakeNotification`, plus the Wi-Fi-specific `NWPathMonitor`.
A private 5-second owner-launched process emits only fixed reason tokens
(`OBSERVING`, `WIFI_PATH_LOST`, `WIFI_PATH_AVAILABLE`, `SLEEP_BEGIN`,
`WAKE`, `STOPPED`); it never logs hostnames, SSIDs, IPs or identifiers.
Without exact local `KATOSYNC_STAGE4AB32B_OS_EVENT_QA_READ_ONLY` opt-in, it
fails with exit 64. The observer has NO network configuration, sleep control,
listener, keychain access, Tauri IPC, persistence, or remote job features.

`src-tauri/src/mesh_os_event_fence_qa.rs` is strictly
`#[cfg(all(test, feature = "stage4j-qa"))]` and unit-tests a conservative,
strictly parsed **deny-only** application of these messages to the canonical
`LiveTlsLease`. A Wi-Fi-restored, wake or observer-ready message cannot
mint fresh TLS proof or revive a previously invalidated lease; malformed
frames and observer termination also invalidate. This pure unit-test receiver
is **not wired to the running supervisor**: plaintext sidecar frames are not
independent authenticated runtime evidence. A future in-process/signed native
integration requires separate review before real long-lived use.

**Evidence to date:** on real M2, unsigned observer compiled; missing opt-in
correctly denied; with opt-in, observed ready, live Wi-Fi path available,
and bounded exit. NO actual sleep, wake or Wi-Fi failure event induced.
The native macOS CI compiles and smoke-tests the observer without hardware
fault injection. Physical M2/M3 Link/Sleep/Wake and live enrollment revocation
acceptance remain OPEN. No production change or authorization increase.

## In-process QA event-to-heartbeat cancellation (synthetic delivery)

The test-only `mesh_os_event_channel_qa.rs` accepts strictly parsed event
frames from a **bounded Tokio channel owned by the same test process** while
an existing TLS heartbeat future remains pending. The `tokio::select!`
branch is event-biased; queued loss, sleep, wake, observer-stop, or malformed
frames synchronously invalidate the canonical `LiveTlsLease` and cancel the
pending heartbeat future. A disconnected producer also drops the current
lease. Wi-Fi `AVAILABLE` and `OBSERVING` are not owner or TLS evidence;
no event can create a new session or grant jobs. A success-ready heartbeat
must first drain all queued event frames, so a pending denial cannot race it.

Six native tests cover real Tokio duplex read cancellation, harmless Wi-Fi
availability, denial prioritization, producer disconnection, forged frames,
and failure to revive a revoked lease. There is no OS daemon, real Wi-Fi
fault injection, cross-device job, keychain access or production supervisor
change. The native AppKit observer and this channel are **not yet connected**;
the QA event input is deliberately synthetic pending a reviewed, signed
in-process macOS event source and independent recovery. Physical sleep/wake,
M2/M3 link loss and live enrollment revoke acceptance all remain OPEN.
