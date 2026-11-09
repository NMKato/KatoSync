# KatoSync Stage4G — physical M2↔M3 TLS/Ed25519 pinned-recipient QA

**Date:** 2026-11-09 (Europe/Berlin)
**Scope:** isolated synthetic-only hardware proof. **NOT** production Mesh trust, mTLS app enrollment or remote-job permission.

## Physical machines and baseline

- M2 `4gi.tv`: `192.168.178.97`, macOS arm64, Node 22.17.0.
- M3 `nmk`: `192.168.178.162`, macOS arm64, Node 22.19.0.
- Both devices are online on the same private LAN. Both had their own isolated checkout of the exact tested branch. The previously notarized Stage35 apps remained intact.
- Before this change, existing `scripts/qa-mesh-two-host-signed-invite.mjs` could confirm TLS 1.3 plus valid Ed25519 signatures, but the server accepted an arbitrary freshly generated **recipient** signing key. That did **not** prove the client was an approved device.
- Baseline actual two-Mac positive signed invite, 2026-11-09: M3 `MESH_TWO_HOST_SYNTHETIC_ED25519_ACK_VERIFIED`, M2 `MESH_TWO_HOST_QA_RECEIPT_VERIFIED`, process exit zero. Baseline proof is **not** authoritative device trust.

## Stage4G hardening

Commit `a1810edb31170de4a4ea52705af00fc5aaaf97ae`:

1. Adds a strict synthetic recipient-public-key pin, **registered out of band on M3 before opening the server socket**. Refuse to start without a canonical 32-byte Ed25519 public key.
2. Adds a separate, short-lived client Ed25519 private key stored **only on M2** under `/tmp/ksmesh2uclient.XXXXXX/key.pem` with mode 0600 and a 0700 parent. The loader rejects arbitrary paths, symlinks, unsafe permissions, unexpected key types and private-key disclosure. The M3 receives only its public-key pin.
3. Verifies the client's signed acknowledgement against the exact request ID, nonce, expiry, account scope and expected target before comparing the verified signer to the **independently approved public pin**. A valid signature from an unknown key is rejected.
4. Keeps a short-lived, explicitly pinned self-signed **TLS 1.3 server certificate**; returns `paired:false`, `transportReady:false`, `remoteJobsEnabled:false`. No new privileged commands, account registration, database access, Keychain interaction, deployment or local-agent execution.
5. Separates `MESH_TWO_HOST_UNAPPROVED_RECIPIENT_PIN_REJECTED` (expected negative hardware mode) from verified positive receipts. The negative mode must never emit `MESH_TWO_HOST_QA_RECEIPT_VERIFIED` for the rejected client.

## Actual physical acceptance evidence

**Positive, approved M2 synthetic identity:**
- M3 private-LAN one-shot server, exact pinned TLS certificate fingerprint passed to M2 over the authorized control channel.
- M2 output: `MESH_TWO_HOST_QA_SIGNED_INVITE_RECEIVED`; `MESH_TWO_HOST_QA_RECEIPT_VERIFIED`; exit **0**.
- M3 output: `MESH_TWO_HOST_SYNTHETIC_ED25519_ACK_VERIFIED`; exit **0**.
- Different credential types: M3's TLS certificate pin validates the *server*, while M3's pre-registered Ed25519 public-key pin validates the *client* acknowledgement.

**Negative, unapproved M2 synthetic identity:**
- M2 independently generated a second valid Ed25519 key, not on the server allowlist.
- M2 received the signed invite but never received a verified receipt; `MESH_TWO_HOST_UNFINISHED`, exit **8**, the **expected denial**.
- M3 output: `MESH_TWO_HOST_UNAPPROVED_RECIPIENT_PIN_REJECTED`; exit **0** under explicit negative-test mode.
- The server did not accept an independently valid signature from an unknown identity.
- Secrets and private PEM content are never included in this document or pushed to GitHub.

**Independent non-hardware checks:** focused Node contracts **9/9**, full Node regression **837/837**, Remote Usage **16/16** and TS/Vite frontend build passed on M3. GitHub PR Fast Gate at commit `a1810ed`: [automatic #42668588116](https://github.com/NMKato/KatoSync/actions/runs/42668588116), all **4/4** Windows Node, Web Build, Rust Format and Deno Mesh Stage4E jobs successful.

## Explicit nonclaims and remaining P0

This is a **synthetic Node TLS 1.3 QA transport**, not mutual TLS at the TLS layer (`requestCert:false`), and **not the native Rust `mesh_transport::client_probe` / `server_probe`** running on the two real Macs. App-bound Ed25519 device keys, SAS human confirmation, account authorization, persisted Keychain identity, verified project owner, live enrollment, actual per-device revocation, replay across sessions, session continuity/reconnect and encrypted Mesh job traffic are **not yet tested**.

Required next steps:
1. Run the existing guarded native Rust `manual_two_host_private_lan_pinned_tls_probe` on both Macs with genuine OS TCP transport and both pinned TLS client/server identities; M3 needs native Rust test runtime or a reviewed signed QA binary. Never treat the Node QA as native mTLS proof.
2. Wire secure owner-approved pin/SAS and Keychain identities to the app's enrollment and trust state, with exact per-device revocation and retry behavior.
3. After that, prove signed/authorized M2↔M3 job dispatch under per-project single-writer/fenced-lease policy, but **no automatic merge, deploy or external beta enablement**.
4. Windows is the third device only after M2↔M3 trust survives restart, offline/reconnect and failed-key tests.

Safety status: existing K2S 15-table `katosync` schema **unchanged**; shared KatoOS user data **unchanged**; no new Supabase project; no remotely executed tasks; PR #247 remains **Draft**, `main` unmerged. TLS listeners and test private keys are ephemeral and removed when tests finish.
