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
The exact Rust FFI QA source SHA `3170975748c37792dd3dfcc90f3a980b8c9d93b3`
passed the [native macOS workflow 44056486038](https://github.com/NMKato/KatoSync/actions/runs/44056486038)
with **41/41 successful CI steps**. Both ignored-by-default native callback tests
passed inside the full Rust QA test process; the original out-of-process
Apple observer and all denial/reconnect regressions also passed. The matching
[PR Fast Gate 44056493956](https://github.com/NMKato/KatoSync/actions/runs/44056493956)
passed all four jobs, and
[Attribution 44056493902](https://github.com/NMKato/KatoSync/actions/runs/44056493902)
passed. This establishes a limited native callback-to-lease QA milestone only:
no production owner/recovery acceptance, signed runtime event listener, real
hardware sleep/network fault, remote job authorization, merge or deployment.
The Objective-C callback code remains **unlinked from the production Tauri
runtime**; its dylib exists only for the explicitly isolated CI tests. A
subsequent documentation-only Git SHA does not retroactively replace the exact
native source SHA used for this evidence.

## Real pinned TLS1.3 supervisor heartbeat + native callback denial (QA-only)

The QA-only `mesh_live_supervisor_qa::heartbeat_client_for_os_callback_qa`
exports its existing heartbeat client implementation to Rust **unit tests
only**, via `#[cfg(test)]`. There is NO new Tauri IPC, runtime listener,
network control, or production command. In the same ignored-by-default
macOS in-process callback QA module, a new test uses **real, mutually pinned
TLS1.3** on Tokio memory duplex (strict approved synthetic Ed25519 peer
pins, real TLS configuration, not real production account enrollment).
The first supervisor-format 48-byte heartbeat receives a valid ACK. The
second heartbeat is correctly received by the test server but the ACK is
intentionally withheld; the genuine bounded Apple callback must emit
`STOPPED`, interrupt the existing supervisor heartbeat future **before its
16-second frame deadline**, invalidate the canonical synthetic
`LiveTlsLease` and cause the original TLS client stream to be dropped.
The peer is not permitted to accept a second ACK and no remote job API is
involved. Timeout guards enclose both native callbacks and the two TLS
participants. This extends the prior standalone Tokio-duplex cancellation
QA by exercising actual pinned TLS and the existing supervisor heartbeat
logic, but does **not** attach an event observer to the real admission/
long-running production supervisor, perform remote device fault injection,
or prove live KatoOS revocation. **Native macOS acceptance completed** for exact source SHA
`ed5affb0c1a4803119281a46411ec05f9130e940`:
[workflow 44058718624](https://github.com/NMKato/KatoSync/actions/runs/44058718624)
was **41/41 successful, zero failed**. The CI job log explicitly shows
three passing ignored-by-default native callback unit tests, including
`genuine_pinned_tls13_supervisor_heartbeat_is_denied_by_native_callback`
(3 passed, 0 failed, completed in 5.01 seconds). Matching
[PR Fast Gate 44058731305](https://github.com/NMKato/KatoSync/actions/runs/44058731305)
was 4/4 successful and Attribution Policy
[44058731255](https://github.com/NMKato/KatoSync/actions/runs/44058731255)
was successful. This proves the **synthetic pinned mTLS supervisor heartbeat
fixture is interruptible by a real passive native callback**, not that a
signed long-running production supervisor handles real physical sleep/network
loss, live enrollment revocation, owner consent, or remote execution.
Separate release/recovery/security gates remain open. This documentation
commit is distinct from the exact native code SHA that generated the proof.


## Owner/enrollment recheck + deny-only native OS events as one QA cycle (17 Nov 2026)

The new pure test-only `mesh_supervisor_guard_qa.rs` models a bounded
supervisor heartbeat cycle with separately supplied owner/both-enrollment
checks **before and after** a pinned TLS heartbeat ACK. Those checks and
the actual authenticated supervisor heartbeat future run within the same
`heartbeat_or_fail_closed` denial fence. On a failed precheck, postcheck,
incomplete heartbeat, OS denial, lost event producer or stale old lease,
the canonical `LiveTlsLease` is permanently invalidated; on denial the
caller must also drop the old TLS stream.

Seven additional native Rust regressions cover pre/ACK/post success order,
owner revoked before I/O, enrollment revoked after an ACK, queued sleep
denial, in-flight link-loss cancellation of Tokio read with no postcheck,
lost native producer, and Wi-Fi return not reactivating an old lease.

The passive native macOS callback/pinned TLS test now wraps the **existing
supervisor heartbeat** in this same gate. It counts synthetic pre/post
checks: on the native STOPPED denial, precheck must have run exactly once
and postcheck must not run. This is a hardware-safe test-only adaptation
with **synthetic** owner/enrollment responses, not a live KatoOS database
revalidation, production event listener, remote job gate or M2/M3 fault.
**Native acceptance completed** for exact code SHA
`1810793dadabce727e220df9fe53a3fc6a5982a1`:
[native macOS run 44061654948](https://github.com/NMKato/KatoSync/actions/runs/44061654948)
finished **42/42 steps SUCCESS**, no failures. The job log explicitly
confirms **7/7** supervisor recheck/event-guard tests and **3/3** native
AppKit in-process callback tests, including the true mutual pinned TLS1.3
heartbeat fixture. Corresponding
[PR Fast Gate 44061666438](https://github.com/NMKato/KatoSync/actions/runs/44061666438)
finished **4/4 SUCCESS** and
[Attribution 44061666349](https://github.com/NMKato/KatoSync/actions/runs/44061666349)
was **SUCCESS**.

The recheck values remain **synthetic only**, and no production KatoOS
admission or live enrollment-revoke has been validated. The code remains
test-only and unmerged; there is no signed, long-running callback integration
in the actual runtime and no real M2/M3 physical fault or remote execution
permission. The next documentation-only Git SHA is distinct from this exact
native source SHA; CI evidence must not be transferred between commits.


## Canonical KatoOS admission read-only adapter – opt-in source binding (17 Nov 2026)

The existing **production-tested-in-isolation** (but not live-operated here)
`mesh_admission::recheck_after_probe(&NativeAdmission, fingerprint)` already
performs current canonical account verification via KatoOS Auth, checks the
same *existing* local Ed25519 device identity in Keychain, compares the exact
locally approved peer fingerprint/public key against the originally admitted
snapshot, queries the owner-scoped read-only `katosync.mesh_devices` roster
under the **user's own JWT/RLS**, and requires both device enrollments to
remain non-revoked. No service-role access or second authorization protocol
is needed.

`mesh_live_admission_recheck_qa.rs` binds that exact function TWICE into the
existing atomic `guarded_supervisor_cycle` around the actual pre-existing
supervisor heartbeat future, with a 45-second total deadline and final
terminal lease denial on timeout. The adapter cannot be built outside
`#[cfg(all(test, feature="stage4j-qa"))]`. It accepts an existing
`SingleQaPermit` (never creates one), checks prior owner opt-ins and a
**distinct exact** read-only QA env opt-in, and refuses swapped fingerprints
or malformed owner scope before any access. It provides no IPC, backend
configuration, remote job, new key, Tauri command, listener or production
runtime integration.

The CI executes only PURE negative unit tests for feature/opt-in gating,
owner-peer binding and bounded error categories, plus a JS security contract
asserting the exact canonical recheck references. CI must NEVER automatically
set the read-only opt-in or request a production token. **No real KatoOS
backend query or M2/M3 hardware fault was performed.** The native Rust CI
result for the new source commit is pending; even after pass it only proves
the safe source-level binding, not successful live Torhaus access, RLS, current
enrollment, or a deployed supervisor. A separately authorized controlled
read-only owner-session test is required for those claims.
