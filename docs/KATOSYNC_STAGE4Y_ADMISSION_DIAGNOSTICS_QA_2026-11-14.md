# Stage4Y – bounded, fail-closed real-key admission diagnostics (QA)

NMKato Solutions | 14 November 2026 | Stacked after Stage4W/4X, no production release

## Reproducible prior evidence

- M2 Pro and M3 Stage4W signed, notarized native executable hashes were identical.
- Existing physical one-shot mTLS QA fails **before opening a TCP listener** on BOTH devices, with `MESH_STAGE4W_ADMISSION_DENIED`.
- An identical error code **does not prove** an identical underlying cause. The existing preflight collapses all rejected identity, trusted-pin, enrollment, revoked and owner checks to one error.
- Stage4W / Stage4X isolated Node contract suite 14/14 PASS when using `node --experimental-strip-types` (Node 22).

## Implementation – read-only, no trust changes

The new `--stage4y-admission-qa-once <existing peer public fingerprint>` CLI path calls the **existing** `authorize()` then `recheck_after_probe()` checks, gated by the existing `stage4j-qa` compiled feature, exact `KATOSYNC_STAGE4W_LAN_QA_ONCE=OWNER_LAUNCHED_QA_ONLY` process-level flag and a single-QA-operation permit.

CLI output is **only** `MESH_STAGE4Y_ADMISSION_OK_NO_REMOTE` or one of a fixed set of sanitized stable rejection categories:
- session unverified
- local identity unverified
- peer approval unverified
- enrollment unverified
- owner changed
- invalid peer format
- unknown admission failure

No account IDs, token, public-key inventory, raw OS errors, private keys, Keychain writes, relay, network listeners, terminal jobs or device permissions are exposed. Failure always exits nonzero.

## Physical verification gates

1. Static QA tests and native Rust compile/test verification with `stage4j-qa` feature.
2. Signed/notarized Stage4Y QA binary, verifiably identical on M2 and M3, with independent local user Keychain consent where macOS requires.
3. Explicit one-shot Stage4Y diagnostics at both devices; only after both pass, rerun Stage4W mTLS listen/connect, including wrong-pin and offline negatives.
4. Persistent tunnel with liveness, revocation and reconnect requires a separate implementation and approval. No success claimed from this diagnostic.

**Release holds:** Draft only, no main merge, no production OAuth changes and no remote operations.

## 15 Nov 2026 – Stage4Z PostgREST enrollment parser fix

Both separately Apple-notarized M2 and M3 Stage4Y native QA commands
returned `MESH_STAGE4Y_ENROLLMENT_UNVERIFIED`. Owner session, local
Ed25519 identity and existing peer approval were reached successfully.

Root cause in source: the owner-scoped `mesh_devices` GET selects
PostgreSQL snake_case columns, whereas `EnrollmentRecord` previously
used serde `rename_all = "camelCase"` and `deny_unknown_fields`.
This rejected a valid PostgREST response at deserialization.

Fix is intentionally limited to the response struct field mapping.
Keep `deny_unknown_fields`, both exact public Ed25519 keys, same
owner, enrollment timestamps, RLS, revocation checks, and existing
local Keychain pin mandatory. No SQL migration, trust mutation,
Keychain reset or remote job authorization.

Verify new native Rust test with an actual snake_case JSON fixture plus
a negative unknown-field fixture, and continue the physical admission
QA on both notarized Macs only after fresh source build/sign/notarize.
The Stage4W cross-site Tailscale transport remains separately blocked
by its intentional RFC1918/same-/24 policy and needs an independent
reviewed overlay QA change.
