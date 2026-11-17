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

## CI fail-fast fence for the synthetic event-to-heartbeat QA bridge

A JavaScript contract syntax error was detected **after** the expensive native
Rust regressions in run [43966848932](https://github.com/NMKato/KatoSync/actions/runs/43966848932).
The regression was in a malformed JavaScript regex on a test-source filtering
line, **not** a failure of the previously executed native heartbeat tests.
The contract now uses explicit `line.trimStart().startsWith("//")` filtering,
and the native workflow performs both `node --check` and `node --test`
**immediately after setup-node, before npm install, frontend build or Rust
compilation**. The duplicate late invocation is removed to reduce runner cost.
This preflight is purely read-only; it does not broaden device permissions,
make the in-process QA bridge a production service, or authorize hardware faults.

## Passive Apple event source to native Rust lease denial (hardware-safe CI)

The test-only macOS module `mesh_os_event_native_pipe_qa.rs` compiles only under
`#[cfg(all(test, feature = "stage4j-qa", target_os = "macos"))]`. Its two tests
are **ignored by default** and require an explicit CI-supplied
`KATOSYNC_STAGE4AB32B_OS_OBSERVER_BIN` path. The CI compiles the exact checked-out
Objective-C AppKit/NWPathMonitor source into an ephemeral **unsigned** local
binary, with no keychain or Apple signing secrets; it is deleted at the end.

The negative test refuses a process with no explicit opt-in (exit 64). The
positive *observation-only* QA test executes the Apple observer (strict five
seconds), pipes actual `OBSERVING`, optional Wi-Fi path, then `STOPPED` frames
through a bounded Rust Tokio channel, and ensures the STOPPED marker cancels a
still-pending `tokio::io::duplex` heartbeat read and invalidates the synthetic
canonical `LiveTlsLease`. The real OS telemetry can **only deny**, never
approve a new peer, owner, job or connection. Child process has a hard deadline,
empty inherited environment and kill-on-drop; no Wi-Fi, Tailscale, power or OS
config changes, no listener or persistent daemon. CI must pass before calling
this test fully verified.

**Boundary remains:** this is an ephemeral **out-of-process stdout bridge used
only by an ignored test**, not an authenticated/signed in-process OS callback
and not a live M2/M3 shared-TLS supervisor. It does not demonstrate a real
Wi-Fi loss, power sleep/wake event or production enrollment revocation. Those
remain blocked until independently verified recovery and explicit approval.

## Native stdout-test timing and CI gate – 17 Nov 2026

The first native CI for the out-of-process observer QA fixture, [run
44048303434](https://github.com/NMKato/KatoSync/actions/runs/44048303434),
passed 33 steps and all six Tokio event-channel tests, but the native
STOPPED-to-Rust test failed at the **child-exit deadline**. It did **not**
show a failed pinned-TLS handshake, runtime network change, or escaped grant.
The test previously forwarded the observer's *first* emitted denial to the
Rust channel. On CI hosts without an active Wi-Fi interface, an immediate
`WIFI_PATH_LOST` can legitimately abort the pending heartbeat **before** the
five-second observer has finished, leading to a subsequent three-second
`child.wait()` deadline failure. This is a test sequencing ambiguity; the
actual observed event was not logged, so this remains an inferred cause.

The scoped **observer-STOPPED integration test** now records every native
frame, but forwards only `OBSERVING` and `STOPPED` into the heartbeat
cancellation channel, requiring a genuinely observed `STOPPED` before it
accepts the lease denial. It also allows up to eight seconds for the child
exit after the STOPPED frame. The **separate** Rust event-fence/channel tests
still prove that `WIFI_PATH_LOST`, sleep and wake cause immediate fail-closed
invalidations; no runtime source or security policy has been weakened.
The native observer integration CI step has moved directly after the initial
Rust compilation and before the long legacy admission/fault regressions, so
future failures are discovered sooner. No production process or hardware
state is affected; the next native CI result is necessary for acceptance.

## Verified CI checkpoint – 17 Nov 2026

The exact QA source commit `4b901f7a97b4d13b10697259d0838bf0a99e5c68`
completed [native macOS workflow 44053584992](https://github.com/NMKato/KatoSync/actions/runs/44053584992)
with **40/40 successful steps, zero failed**. The specifically gated,
ignored-by-default AppKit/NWPathMonitor observer integration test passed on a
native macOS runner: it compiled the Objective-C source, asserted missing
opt-in is denied, consumed genuine bounded `OBSERVING`/`STOPPED` frames,
cancelled a still-pending Tokio heartbeat and invalidated a synthetic
`LiveTlsLease`. The rest of the native QA regression suite and unsigned
compile-only artifact passed. The matching PR Fast Gate
[44053595162](https://github.com/NMKato/KatoSync/actions/runs/44053595162)
was **4/4 SUCCESS**; matching Attribution Policy 44053595181 was SUCCESS.

This success is specific to the tested code SHA. It is not a signed or
production OS event source, evidence of physical M2/M3 network loss or
sleep/wake, a real owner/enrollment revocation, or a remote-execution grant.
Draft PR #279 stays stacked on #278, unmerged and not deployed. Any subsequent
documentation-only Git commit has its own branch SHA, distinct from the
verified native source SHA; no new native-proof claim is made for it.

## Native in-process callback QA candidate – 17 Nov 2026

The new `scripts/qa-stage4ab32b-macos-native-callback.m` exports only
`katosync_stage4ab32b_native_events_qa` as an explicit, owner-opted-in
five-second **in-process** AppKit/NWPathMonitor source. No process starts
outside the Rust QA test; no stdout framing or shell execution is needed.
It makes no OS/network/power/Keychain changes. A serial dispatch queue plus
synchronized `active = NO` and `dispatch_sync` drain callbacks before the
borrowed Rust event context is released. The short-lived QA dylib is never
unloaded before process exit because already queued OS callback code must not
race dynamic unloading.

`src-tauri/src/mesh_os_event_native_ffi_qa.rs` is **test-only on macOS**,
`#[ignore]` and requires an exact CI-built unsigned native dylib path. Its
negative test ensures missing opt-in returns 64 without events. Its positive
test uses a real passive native in-process callback (without inducing sleep,
wake or network loss) to record `OBSERVING`, possible Wi-Fi status and
`STOPPED`, then passes bounded denial frames directly to the existing
`heartbeat_or_fail_closed` Rust QA guard. A pending Tokio duplex heartbeat
must be cancelled and a **synthetic** canonical lease invalidated by STOPPED.
The separate, already verified frame-fence tests still cover link loss,
sleep/wake, malformed frames and disconnection. A headless CI host might
begin with `WIFI_PATH_LOST`; this specific STOPPED test records that hint
but isolates the terminal observer-stop assertion.

**Pre-CI hardware-safe evidence:** M2 compiled the native unsigned dylib,
resolved the C entrypoint, and ran a passive pthread smoke test. Negative
opt-in returned 64; the positive path returned zero with exactly one
`OBSERVING`, one `STOPPED`, and one Wi-Fi path event. The Rust QA source
passed `rustfmt --check` separately on the M2. There were NO physical
sleep, wake, WLAN, Tailscale, system power or runtime privilege changes.
The complete Rust FFI QA CI is pending, so no deployment/owner/recovery
acceptance is claimed. The source is not linked into the production Tauri
app and does not create a persistent runtime observer.
