# KatoSync 2.0 Private Beta / 4.0 Vision – Integration Audit (17 Nov 2026)

**Governance:** Development/read-only inspection only. No `dev`/`main` merge, deploy, session/token refresh, device network change, model download, enrollment/revocation, remote jobs or installation in this audit.

## Identity of the releases

- Repository package and installed M2 Stage4U/Stage4R QA bundles identify as **2.0.0**. KatoSync **4.0** is a separate target scope in [#224](https://github.com/NMKato/KatoSync/issues/224), **not a released version**.
- Private Beta work is tracked by [#39](https://github.com/NMKato/KatoSync/issues/39), stacked P0 chat/dispatch [#175](https://github.com/NMKato/KatoSync/pull/175), Beta-core [#281](https://github.com/NMKato/KatoSync/pull/281).
- Native M2/M3 pinned mTLS one-shot and independent no-refresh CI are validated QA primitives; persistent signed transport/supervisor and user-authorized cross-device job are **not verified** ([#269](https://github.com/NMKato/KatoSync/issues/269), Draft [#279](https://github.com/NMKato/KatoSync/pull/279)).

## Read-only verification this turn

- M2 and M3: Remote Desktop Commander reported online; **this is not KatoSync Mesh connectivity evidence**.
- M2: two installed KatoSync Stage4U/Stage4R QA bundles are locally code-signature **valid** (`codesign --verify --strict`), both report 2.0.0. No notarization/install GO inferred.
- M3: KatoSync process present. A `llama-server` is active **for KAI Desktop's Gemma 3 1B**, not proof that KatoSync Gemma 4 E4B/REX is live.
- Windows: Desktop Commander reachable; local `llama-server` process present; no running KatoSync app. This says nothing about installer readiness.
- Free storage observed: M2 ~7.2 GiB, M3 ~23 GiB, Windows C: ~38.3 GiB. **No automatic multi-GB model download/build before storage check**.
- Isolated QA branch #281: `npm run test:beta-core` previously **30/30**; entire Node suite **337/337**; focused source-level orchestration, handoff, local model catalog, mesh tests **62/62** this turn. These tests do **not** verify shared RAG, named agent birth, signed app GUI or live cross-device dispatch.

## Feature readiness (strict distinctions)

| Capability | Evidence | Beta GO? |
| --- | --- | --- |
| Local project Gemma chat, memory/history, NOT_IN_MEMORY | Positive isolated M2 GUI demonstration 29 Oct (#130/#175) | PARTIAL; package/M3/Windows pending |
| Codex/Claude read-only project jobs | Positive isolated M2 GUI receipts 29 Oct (#125/#175) | PARTIAL; package/M3/Windows pending |
| Dynamic project status / job truth / cross-project handoff | Source tests and #12/#30/#39 specifications | OPEN integrated real E2E, no verified dynamic multi-project synchronization |
| REX shared RAG/knowledge graph | Design in #33; project-scoped memory and retrieval primitives | OPEN cross-project permissions and multi-provider same-source E2E |
| Local Gemma/Custom LLM agent | QA history for local answer; separate other-app llama-server currently observed | OPEN managed KatoSync runtime, tool use, fallback and signed QA app |
| Agent Birth / AI chooses name / persisted persona / wake/restart | 4.0 requirement #224 | OPEN positive runtime evidence |
| M2/M3 Mesh SAS, owner pairing, TLS | Verified selected physical tests | PARTIAL; durable Mesh/revoke/sleep/cross-device job OPEN |
| Signed installer / Windows | M2 older QA signatures valid; Windows app not running | OPEN current exact release candidate |

## MCP / RC67 truthful state

- Connected KatoSync Custom MCP `katosync_qa_ping`: **authenticated_synthetic_qa**, `meshConnected=false`, `deviceAccessEnabled=false`. **This currently does NOT grant real device access.**
- Source-only [RC67 registry](https://github.com/NMKato/KatoSync-Remote-MCP/blob/feat/rc67-mvp-connector-tool-registry-20261117/product/rc67-mvp-native-tools-draft.json): **34 tools**, grouped Device 3, Files 8, Search 4, Terminal 6, Audit 3, Git 4, Mesh 2, Projects 2, Jobs 2; 20 read, 9 write, 5 execute. Separate RC65 `katosync_devices_list` and `katosync_device_status` are NOT yet live.
- Duplex envelope uses owner/tenant/grant/device/session/request/seq/time-bounded Ed25519 JWS for outbound Desktop→DO WSS; **contract QA only**, not an active socket.
- First real E2E must be **ChatGPT → OAuth MCP → Cloudflare DO → native approved M2/M3 executor → independently verified response → ChatGPT**. First expose read-only `devices.list/status`, directory, file, Git status and Mesh peers only after capability/consent/online freshness and signed device proof.
- Later: bounded `start_process`/output/interactive CLI, file edits/Git push with per-operation owner consent, idempotency, revoke/cancel, audit. Screen, keyboard/mouse and binary installers require separately verified OS permissions; no hidden RDC proxy.
- [RC67 full handoff](https://github.com/NMKato/KatoSync-Remote-MCP/blob/feat/rc67-mvp-connector-tool-registry-20261117/docs/RC67_MVP_CONNECTOR_RELEASE_AND_DESKTOP_HANDOFF_20261117.md).

## Minimum actionable acceptance sequence

1. Review actual 2.0/4.0 integrated sources (avoid blind PR-stack merge). Pick exact source SHA, protect existing running/stable QA bundles.
2. Package isolated **signed** macOS private-beta candidate after ensuring free disk. Test M2/M3 login → project open → offline local Gemma answer/history → real scoped Codex/Claude read-only receipts and clear failure UI.
3. Prove one selected-owner authenticated Mesh presence/state and persistent session **without** using Remote Desktop Commander as substitute for Mesh. Then owner-approved read-only cross-device job/ACK with offline, replay, revoke and mismatched-device negatives.
4. Prove shared REX/RAG retrieval via two providers over an explicitly shared, non-sensitive, permissioned project corpus; verify references/provenance, project isolation, no hallucinated status.
5. Prove named-Agent Birth once, owner accepts/renames, persona and episodic memory survive restart, no unsolicited tool execution. Label this 4.0 gate, not implied by 2.0 chat.
6. Complete Windows clean-install runtime and release signing/notarization/rollback; only then consider broadened private beta. Keep public multi-tenant release separate.

This record is a checkpoint, **not** a release authorization.
