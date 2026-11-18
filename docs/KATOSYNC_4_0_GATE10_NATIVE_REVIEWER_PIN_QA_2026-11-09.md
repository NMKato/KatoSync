# KatoSync 4.0 — Gate 10 native unabhängige Reviewer-Signaturprüfung (QA)

**Stand 09.11.2026 — isolierter QA-Entwicklungsbranch, kein Release, keine produktive Datenbankänderung.**

## Geprüfte Vertrauensgrenzen

Die bestehende native KATOOS-Sitzung (macOS Keychain / Rust) bleibt die einzige
Anmeldung. Der Tauri-Befehl `mesh_owner_review_readback_qa` nimmt weiterhin nur
`decisionId`, `grantId` und eine **nicht autorisierende** erwartete Owner-UID
entgegen. Er transportiert keine JWTs, Reviewer-Signaturen oder Public Keys zur WebView.

Nach der bereits vorhandenen Owner-, Zeit-, Scope- und Formatprüfung ruft die
native Brücke jetzt `memory_fabric::verify_gate10_native_review` auf. Der neue
Pfad benutzt die **bereits bestehende** strenge Rust-Ed25519-Prüfung für das
14-Felder-Gate9-Protokoll mit Domain Separation, 60-s-Signaturalter und
15-s-Frische der HTTP-Rücklesung.

Die entscheidende neue zweite Autoritätsquelle ist `RELEASE_REVIEWED_PINS` in
`reviewer_attestation.rs`. Sie besteht ausschließlich aus im Rust-Quellcode
fest freigegebenen Reviewer-UIDs, Projekt-IDs, Schlüssel-IDs, Revisionen und
Public Keys. **Die Liste ist aktuell absichtlich leer.** Ihre Belegung
erfordert eine separate menschliche Identitäts-, Schlüsselfingerprint- und
Änderungsprüfung sowie einen neu signierten und überprüften QA-Build.
Weder Serverdaten noch WebView, Environment, lokale Einstellungen oder
dynamisch geladene Dateien dürfen neue vertrauenswürdige Pins einführen.

Ein identischer, aber von der Edge-Antwort selbst gelieferter Public Key ist
**keine** unabhängige Vertrauensquelle. Bei fehlendem Pin ist das Ergebnis
`None` (nur nicht autorisierende Serverevidenz); bei falscher Revision,
abweichendem Pin, doppelter Pinzuordnung, falscher Signatur, fremdem Owner,
abgelaufenem Nachweis oder signierter Ablehnung erfolgt kein positives Ergebnis.

## Frische Status- und Widerrufsprüfung

Die KATOOS-Edge-Rücklesung prüft weiterhin live die echte `/auth/v1/user`-UID,
aktive Mitgliedschaft, unabhängige Reviewer-Registrierung, aktive Reviewer-
Signierschlüssel, Projektfreigabe, konsumierte Owner-Challenge sowie den
konkreten Owner-/Grant-Scope. Für den aktuellen nativen Gate10-Pending-Verifier
akzeptiert der Endpoint nun **nur `grant.state=pending`**, nicht `active`.
Bereits aktivierte/historische Grants benötigen später eine eigene
frisch signierte Autoritätsprüfung; die 60-s-Signaturregel wird **nicht** gelockert.

Die Edge ist die Onlinequelle des **aktuellen Rollen-/Widerrufsstatus**;
der separat geprüfte native Pin ist die unabhängige **Schlüsselautorität**.
Eine kompromittierte Edge-Antwort allein kann damit keinen neuen Signierkey
als nativ vertrauenswürdig einführen. Ein bereits kompromittierter,
unwiderrufener, tatsächlich gepinnter privater Reviewer-Schlüssel wäre hingegen
eine separate Sicherheitskrise und muss durch Revocation/QA-Rotation behandelt werden.

## Negativ- und Freigabepolitik

- Selbstfreigabe und anderer Owner / Grant / Projekt / Key-Revision: Abbruch.
- Korrekt signierte Reviewer-Ablehnung: `Some(false)`, native Ablehnung.
- Fehlender menschlich freigegebener Pin: `None`, **niemals** Approval.
- Separat gepinnte und frische Reviewer-Signatur: ausschließlich interner
  kryptografischer QA-Nachweis, **keine** Grant-/Ledger-/Mesh-/Fernjob-Rechte.
- Frontend bleibt konservativ `server_attested_unverified`,
  `independentReviewerVerified:false`, `grantsRights:false`,
  `verifiedPercent:null`, `remoteJobsEnabled:false`.
- Reviewer-Identität, Echt-Key, Enrollment, echte Owner-Challenge und
  unabhängiger menschlicher Review sind **nicht** simuliert oder erstellt.

## QA-Nachweise vom 09.11.2026 (isolierter M2)

- `cargo fmt --all --check` und `git diff --check`: bestanden.
- Neue Rust-Pin-/Signatur-Negativprüfung: bestanden.
- Gesamte Rust-Library: **306 bestanden, 8 planmäßig ignoriert**.
- Gesamte Node-Suite mit begrenzter Parallelität: **748/748 bestanden**.
- Remote Usage: **16/16 bestanden**.
- QA-Edge-Lesehandler: **4/4 gezielte Fake-Transport-Tests bestanden**,
  einschließlich `active`-Grant-Ablehnung.
- TypeScript-/Vite-Build: erfolgreich, **1.911 Module**.
- Keine Live-KATOOS-Datenbank- oder Reviewer-Registrierungsänderung;
  kein echter unabhängiger Reviewer oder positiver Live-E2E vorgetäuscht.
- Rust-Tests benutzen temporäre leere QA-Ressourcenordner und das
  vorhandene kompilierte Build-Cache; dies ist **kein App-Packaging-Test**.

## Nächste echte Freigaben (P0)

1. Zweite **eigenständige berechtigte natürliche Person** administrativ
   als Reviewer prüfen und registrieren; Proof-of-Possession und Public-Key-
   Fingerprint out-of-band vergleichen, Selbstbestätigung ausschließen.
2. Den Public Key und die Revision nach unabhängigem Source Review als
   release-geprüften nativen QA-Pin aufnehmen; signierten QA-Build herstellen.
3. Authentifizierter KATOOS-Pending-Grant → konsumierte Owner-Challenge →
   signierte Reviewer-Entscheidung → live Edge Readback → native Ed25519-
   Prüfung mit negativem Revocation-, Account-Switch- und Replay-Test.
4. **Separat** Stage4E-Quota-Migration (Free 0 / Pro 10 und Entitlement-Ablauf)
   inklusive RLS-, Rollback- und M2/M3-Live-Abnahme prüfen. Erst danach
   Gate8 Accepted-Ledger, verifiedPercent/ETA und Release Gate abnehmen.

PR #247 bleibt Draft. Weder `main`, produktive SQL-Daten, OAuth-Schlüssel,
Reviewer-Enrollment noch die installierten Anwendungen werden verändert.
