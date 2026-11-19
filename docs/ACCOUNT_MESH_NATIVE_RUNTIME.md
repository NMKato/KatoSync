# Native account Mesh runtime

Implemented source contract for the account device onboarding flow. The Cloud
control contract is documented separately in ACCOUNT_MESH_NETWORK_CONTRACT.md.

## Authority and connection intent

The main role comes only from a fresh native authenticated Cloud configuration:
owner, session, local registered key, main device ID and exact account revision.
Changing a main ID, key, owner or revision requires a new explicit connection.
A revoked or unavailable selected main is not silently replaced.

The secure local intent stores public bindings and an ask/automatic connection
mode. It contains no token, private key or action permission. Automatic restart
resume requires the same authenticated native session, fresh eligible Cloud
registrations and unchanged full locally approved peer keys. Explicit Stop
disables the saved peer even before an in-flight resume has installed RAM state.
Logout invalidates generations and clears the saved intent. Session binding
prevents reuse after a new login even if secure storage deletion fails.

Ask means an explicit user start after application restart. A currently started
logical connection can recover from a brief network loss after fresh admission.
Automatic permits restart resume. Neither mode changes per-operation approvals.

## Explicit account peer review

Review requires the existing fresh signed mutual possession proof and the full
peer key from the current authenticated same-owner directory. No synthetic SAS
confirmation is supplied. The explicit approval button commits the local key
pin, saves the selected intent with readback, and starts actual transport.

A review expires within 120 seconds, uses Unix milliseconds in IPC, and binds
owner, authenticated session, exact peer key, main ID/revision and proof digest.
The exact review ID remains tracked through asynchronous approval. Cancellation
before pin commit prevents approval; cancellation after a completed pin commit
prevents the delayed profile/start commit. A stale cancellation cannot remove
a newer review or an unrelated pending proof.

MESH_ACCOUNT_PIN_APPROVED_CONNECTION_NOT_STARTED explicitly reports partial
completion: the user approved the pin, but no connection success is claimed.
The UI must refresh pins/status and offer a new connection attempt.

Local Revoke stops that peer first, removes its exact owner-bound full key and
saved profile, and does not grant or alter Cloud membership. Pending proof
cleanup is limited to that same public key.

## Bounded multipeer transport and discovery

One main-device supervisor owns at most one concrete private LAN listener and
one already available private-overlay listener. Each admitted peer has its own
bounded mTLS channel, sequence, heartbeat lease, generation and cancellation.
There are at most nine participant profiles. Stopping one active peer does not
stop another peer's active channel. Pending start/review mutations are
conservatively invalidated by Stop.

Bonjour resolves only the fixed expected fingerprint service name under
_katosync-mesh._tcp. It provides an untrusted route hint. Destinations must be
distinct RFC1918 IPv4 hosts on the same /24 as a concrete Ethernet/WLAN interface.
There is no wildcard bind or port scan. The existing optional verified Tailnet
route remains available. This is not a universal Internet relay.

Existing local pin, Cloud enrollment, strict Ed25519 mTLS and owner admission
remain mandatory. Fresh Cloud topology/revocation checks run during live
channels and before the server sends its heartbeat acknowledgement. A device
list, saved preference, discovery timestamp or completed pairing proof cannot
produce a connected status. Connected requires a currently running open channel
and a fresh heartbeat lease. No Mesh remote job dispatcher is enabled here.

On macOS the integration must include a local-network usage explanation and
the Bonjour service type in the signed app Info.plist. Real app permission and
physical reachability require app-level acceptance; a terminal-only discovery
test does not provide that evidence. Apple reference:
https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy

## Source checks and pending acceptance

Twelve new tests are part of the actual native crate under cfg(test): profile
roundtrip/key binding, stop and ask restart behavior, owner/session/main/revision
changes, participant topology and duplicate peers, LAN route/service restrictions,
full-key mutual-proof freshness, independent peer cancellation, in-flight review
cancellation, Cloud main revocation, empty resume after main change and stale
peer completions. The Cloud adapter has its separate six native validators.

Source formatting and whitespace checks passed. The focused local composition
harness was stopped during dependency compilation because the cold build was
slow; it did not produce a test pass. The integrated native package workflow is
the required full compile/test gate. Physical reconnect, multiple participants,
Bonjour OS permission and the signed app user journey are still acceptance
checks, not claims established by this source commit.
