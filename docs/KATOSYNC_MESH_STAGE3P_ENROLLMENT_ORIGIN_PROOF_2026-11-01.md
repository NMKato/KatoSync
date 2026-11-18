# Stage 3P — Mandantengebundenes Enrollment-Proof v2, QA-Only

**01.11.2026 · NMKato Solutions · gestapelter Draft auf Stage 3O**

## Implementierung

Der bisherige native Enrollment-Proof v1 signiert Owner, Challenge-ID, Nonce, Public Key und Ablaufzeit. Die produktive Enrollment-Complete-Funktion verlangt acht Nutzdatenfelder, wobei der native Enrollment-Client den Gerätenamen und das Betriebssystem ergänzt. Diese beiden Angaben sowie der Supabase-Origin waren in v1 nicht Bestandteil der Ed25519-Signatur.

Stage 3P ergänzt daher einen **neuen, unabhängigen QA-Vertrag**, ohne produktive, SHA-gepinnte Inbox-/Enrollment-Quellen zu verändern:

- `katosync-mesh-enrollment-proof-v2` enthält exakt `protocol`, `challengeId`, `origin`, `nonce`, `publicKey`, `expiresAt`, `signature`, `deviceName`, `platformOs`.
- Die Ed25519-Nachricht lautet, durch Zeilenumbrüche getrennt: `katosync-mesh-device-enrollment-proof-v2`, Owner, exakter Supabase-Origin, Challenge-ID, Nonce, Public Key, Ablaufzeit in Millisekunden, Gerätename, Betriebssystem.
- Die WebCrypto-Prüfung verlangt canonical Base64URL, passende Challenge- und Eigentümerdaten, unbenutzte Challenge, gültige Ablaufzeit und exakten QA-Origin. Falscher Mandant oder nachträglich veränderter Gerätename/Betriebssystem scheitern.
- Der **nur in Rust-Tests** verwendete Ed25519-Signer erstellt einen öffentlichen, synthetischen Rust-/Serde-Nachweis in `tests/fixtures/meshEnrollmentRustV2Stage3P.public.json`. Keine echten Keychain-Schlüssel, Zugangstoken oder Benutzergeheimnisse werden verwendet.

## QA-Handler

`supabase/functions/mesh-enrollment-preview` enthält einen vom produktiven Device-Enrollment getrennten, standardmäßig abgeschalteten Edge-Handler. Freischaltung setzt exakte QA-Referenz/Deployment-ID und `KATOSYNC_MESH_ENROLLMENT_V2_QA_STAGE=verify-only` voraus. Es werden ausschließlich `GET /auth/v1/user`, zwei Mitgliedschaftsprüfungen und eine auf Owner und Challenge-ID begrenzte `GET`-Abfrage der Challenge-Tabelle ausgeführt.

Bei erfolgreicher Signatur gibt der Handler `QA_ENROLLMENT_SIGNATURE_VERIFIED` zurück. **Das bedeutet ausdrücklich keine erfolgreiche Registrierung und keine Gerätefreigabe:** `discovered=false`, `paired=false`, `transportReady=false`, `remoteJobsEnabled=false`. Keine Mutation, kein Invite, keine mTLS-Session.

## Prüfungen und offene Freigaben

Am M2 wurde der native Rust-Test `qa_emit_stage3p_origin_bound_enrollment_v2_fixture` erfolgreich ausgeführt. **27/27** kombinierte Offline-Tests für Stage3L/3M/3N/3O/3P bestanden. Die echten Produktivdateien blieben unverändert. Temporäre Tauri-Ressourcen wurden wieder entfernt.

Die **tatsächliche Cloud-Zulassung ist weiterhin nicht nachgewiesen**: Isolierter Supabase-Branch mit GoTrue/JWT/Edge-PostgREST, vollständige native V2-Sitzungsbindung, QA-Registrierung mit verifizierter DB-Schreibberechtigung und M2↔M3-Keychain/SAS/mTLS müssen später ausdrücklich autorisiert und getestet werden. Den bisherigen v1-Registrierungspfad nicht durch ein bloßes URL-Rewrite auf QA umstellen.

**Draft-Only. Kein Merge, kein Deployment, keine kostenpflichtige Cloud-Ressource und keine automatische Gerätekopplung.**
