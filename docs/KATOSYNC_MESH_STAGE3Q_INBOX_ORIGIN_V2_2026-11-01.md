# KatoSync Mesh Stage 3Q – mandantengebundene Inbox-Signaturen und QA-Verifikation

**01.11.2026 · NMKato Solutions · isolierter gestapelter Draft, nicht deployen**

## Sicherheitsproblem

Die produktive Inbox benutzt bislang zwei unabhängige Signaturen: `katosync-mesh-inbox-send-v1` für die signierte Einladung und `katosync-mesh-inbox-recipient-v1` für die Aktion des Empfängers. Beide sind an die produktive KATOOS-Identität gekoppelt; ein frei umgestellter URL-Pfad darf keine QA-Berechtigung erzeugen. Die ursprünglichen Inbox-/Enrollment-Dateien sind per SHA-256-Review-Gate geschützt und bleiben unverändert.

## Stage3Q-Testvertrag

Eine zusätzliche, **ausschließlich im QA-Zweig verifizierte** Protokollversion erweitert die Ed25519-Signaturen um die exakte Supabase-Mandantenadresse:

- Versandprotokoll `katosync-mesh-inbox-send-v2`: `protocol`, `origin`, `sourceDeviceId`, `targetDeviceId`, `signedOffer`, `dispatchSignature`. Der unterschriebene Text ist `protocol|owner|origin|sourceDeviceId|targetDeviceId|accountScope|publicKey|nonce|expiresAt`.
- Das `signedOffer` bleibt im ursprünglichen kanonischen Format `katosync-mesh-pairing-v1`, aber sein SHA-256-Account-Scope bindet sich explizit an `owner` und **denselben** QA-Origin. Offer- und Dispatch-Signatur werden unabhängig geprüft.
- Empfängerprotokoll `katosync-mesh-inbox-recipient-v2`: `protocol`, `origin`, `deviceId`, `action`, `requestId`, `nonce`, `expiresAt`, `signature`. Der unterschriebene Text ist `protocol|owner|origin|deviceId|action|requestId|nonce|expiresAt`. `list` verlangt die fest definierte Null-Sentinel-ID; `accept` und `reject` erfordern eine andere valide Request-ID.
- Strikte Parser für genau die erlaubten Felder und kanonische Base64URL-Codierung; falscher Mandant, Eigentümer, Gerät, Nachrichtenrichtung, Ablaufzeit, Signatur oder downgradetes Protokoll wird verweigert.

Der native Rust-Test `qa_emit_stage3q_tenant_bound_inbox_v2_fixture` verwendet ausschließlich synthetische Ed25519-Schlüssel und erstellt `tests/fixtures/meshInboxRustV2Stage3Q.public.json`. Beide **real aus Rust** erzeugten Signaturen wurden durch Edge-WebCrypto verifiziert.

## Separater Edge-QA-Endpunkt

`supabase/functions/mesh-inbox-preview` akzeptiert nur `verify-send` oder `verify-recipient` und ist ohne `KATOSYNC_MESH_INBOX_V2_QA_STAGE=verify-only`, `KATOSYNC_MESH_RELAY_QA_MODE=isolated-preview-only` und die exakt kontrollierte QA-Projekt-Deployment-ID gesperrt. Er prüft online `/auth/v1/user`, die aktive Mitgliedschaft, registrierte und nicht gesperrte Geräte samt den passenden öffentlichen Schlüsseln sowie die Signaturen. Die Mitgliedschaft wird nach der kryptografischen Prüfung erneut kontrolliert.

Es erfolgen ausschließlich `GET`-Abfragen. HTTP-Redirects sind ausdrücklich verboten, einschließlich in der gemeinsamen Stage3M-Preview-Mitgliedschaftsabfrage. Die Antwort enthält **keine** Einladungen oder Gerätedaten; immer `verifyOnly=true`, `invitationCreated=false`, `decisionApplied=false`, `paired=false`, `transportReady=false`, `remoteJobsEnabled=false`.

**Das ist keine Single-Use-Entscheidungssperre:** Im Verify-only-Betrieb werden keine Nonces konsumiert oder Einladungen geschrieben. Wiederholungen signierter QA-Nachweise innerhalb des Frischefensters sind für die reine Verifikation möglich und vermitteln keine Rechte. Für echte Annahme-/Ablehnungsaktionen muss ein separater, transaktionsgesicherter Schreibpfad mit Replay-Abwehr eingeführt und geprüft werden.

## Prüfnachweise und verbleibende Risiken

Auf dem autorisierten M2: nativer Rust-Fixture-Test erfolgreich; 7 Signatur-/Hash-Fälle und 4 QA-Endpoint-Fälle sowie 31 übernommene Regressionen erfolgreich, insgesamt **42/42** kombinierte Offline-Tests bestanden. `cargo fmt --check`, `git diff --check` bestanden. Temporäre Tauri-Testressourcen entfernt.

**Nicht nachgewiesen:** Cloud-GoTrue/JWT- und echter PostgREST-Transport, native produktive URL-/Issuer- und Keychain-Bindung, V2-Senden/-Empfangen mit bestätigtem transaktionalem Replay-Schutz, Migrationen und RLS in isolierter QA-Cloud, tatsächliche M2↔M3-SAS-/mTLS-Paarung. Keine produktiven KATOOS-Dateien wurden überschrieben, keine Cloud geschrieben, keine Geräte freigegeben.

**Freigabe:** Nur Draft. Kein Merge, keine kostenpflichtigen Preview-Projekte und kein Cloud-Deployment ohne separate Zustimmung.
