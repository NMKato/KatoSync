# KatoSync 4.0 – Trust Gate 9: Unabhängig signierte Reviewer-Entscheidung

**Stand 05.11.2026 · QA-only · gestapelt auf Gate 8 / PR #239.**

## Ergebnis in echter KATOOS-Infrastruktur

KATOOS-Cluster `xbnnlyyxiilklsygxcof`, separates Schema `katosync`.

Die additive Migration `20261105100122_katosync_reviewer_signed_attestation_gate9.sql` wurde **erst transaktional mit ROLLBACK erprobt**, danach live angewandt. Der Dateiname entspricht exakt der von Supabase registrierten Live-Migrationsnummer `20261105100122`.

- Neue Tabelle `feature_reviewer_signing_keys`: projektextern autorisierte Reviewer, unabhängig provisionierte Ed25519-Public-Keys, SHA-256-Fingerprint, Key-Revision, Admin-Beleg, Status und Revocation. **RLS aktiviert, keinerlei `anon`-/`authenticated`-Zugriffsrechte**, nur administrative Serverrechte.
- Prüfer-Schlüssel sind nach der Provisionierung unveränderlich und nach Widerruf nicht still reaktivierbar. Maximal ein aktiver Reviewer-Schlüssel je Reviewer. Der Benutzer kann sich weder selbst anmelden noch ein Reviewer-Schlüsselpaar im Backend als freigegeben eintragen.
- Bestehende Tabelle `feature_owner_review_decisions` verlangt neu die komplette signierte Belegbindung: Reviewer-Key-ID/-Revision/Public-Key-Snapshot, Owner-Key-ID, Grant-Revision, Projekt-/Subject-ID, Signatur, Signaturzeit und Protokollversion. Alle Einträge bleiben append-only; dieselbe Reviewer-Signatur ist nicht mehrfach verwendbar.
- Der **separate Admin-Activation-Trigger** `feature_approver_audit_guard` akzeptiert einen Statuswechsel `pending → active` nur bei einem zulässigen, unterschriebenen, an die konkrete Owner-Challenge gebundenen Review einer anderen aktiven Person mit aktuell aktivem Reviewer-Schlüssel. Das ursprüngliche Owner-/Account-/Projekt-Revocation-Gate bleibt erhalten.
- `feature_owner_review_submit` ist `SECURITY INVOKER`, **nur `service_role` darf EXECUTE**. Es schreibt eine Reviewer-Entscheidung; es aktiviert **keinen** Owner-Grant. Normaler Login und Self-Review bleiben unberechtigt.

Live verifiziert: Datenbank-RLS und Privilegien, `feature_owner_review_submit` gibt ohne vorher administrativ angelegten Grant **NULL** zurück. Alle realen Projekt-, Owner-, Reviewer-, Schlüssel- und Entscheidungszähler verbleiben **0**.

## Deployte KATOOS-Edge-Funktion

`feature-owner-review-qa`, Version 1, `verify_jwt=true`:

`https://xbnnlyyxiilklsygxcof.supabase.co/functions/v1/feature-owner-review-qa`

Die Funktion akzeptiert ausschließlich zwei POST-Aktionen:

1. **prepare**: Authentifizierter Reviewer fragt für exakt einen vorher administrativ erstellten Pending-Grant und eine nachweislich verbrauchte Owner-Key-Challenge ein kanonisches, 14-feldriges Review-Payload ab. Rückgabe enthält **keine Schreibfreigabe** (`grantsRights:false`).
2. **attest**: Der Reviewer signiert dieses Payload mit seinem **selbst verwahrten** Ed25519-Private-Key. Der Server prüft über die echte KATOOS-`/auth/v1/user`-Identität die aktive Mitgliedschaft, aktive Reviewer-Rolle, separaten aktiven Public Key, den anderen Subject-User, das aktive Projekt und den unveränderten Pending-Grant sowie die konsumierte Owner-Challenge. Der Signaturzeitpunkt darf maximal 60 Sekunden alt sein. Nur dann erfolgt der atomare Schreibversuch.

Der Signatur-String gehört zu **`KatoSync independent-owner-review v1\n`** und einem kanonischen JSON-Array aus Protocol, Grant/Challenge/Projekt/Subject, Owner-Key-ID und Grant-Revision, Reviewer-UID/Key-ID/Key-Revision/Public-Key, Entscheidung/Begründung und Zeitstempel. Signaturmanipulation oder Änderungen an irgendeinem Feld führen zum Abbruch. Ein einfacher `approved:true`-Parameter hat keine Funktion.

**Live-Smoke:** Aufruf ohne Login gibt **HTTP 401** zurück. Kein gültiger Benutzer-Reviewer-/Owner-Onboarding-Datensatz wurde als Test angelegt.

## Dokumentierte Sicherheitsgrenze

**PostgreSQL verifiziert Ed25519 nicht kryptografisch.** Es kontrolliert Rollen, Revisionsbindung, Status und atomare Entscheidungsspeicherung. Die Signaturprüfung erfolgt in der vertrauenswürdigen KATOOS-Edge-Funktion. Ein Administrator mit vollständig kompromittiertem `service_role` könnte SQL-Daten manipulieren oder gültig aussehende Signaturdaten einfügen. Deshalb muss die nachfolgende native Beta-Abnahme die **gespeicherte Reviewer-Unterschrift unabhängig selbst verifizieren**, bevor ein Verified-Accepted-Ledger-Wert für Benutzer freigegeben werden darf.

Ebenfalls ausstehend: Vertrauenswürdiges reviewer-key enrollment / Key-Possession / menschliche Freigabedokumentation, sichere Schlüsselverwahrung beim Reviewer, tatsächliche zwei verschiedene KATOOS-Konten, echte positive End-to-End-Review und sofort wirksame Key-Revocation. Es wurden **keine** Reviewer-, Owner- oder Projektberechtigungen automatisch erstellt.

## Test-/Release-Checkliste

- Live: SQL-Schema- und Privilegien-Abfragen, Abweisung fehlender Grants und API-Unauth-HTTP-401.
- Signaturtest mit echtem testweise erzeugtem Ed25519-Schlüsselpaar: gültig; falscher Owner, anderer Reviewer, anderes Projekt, andere Challenge, Grant-/Key-Revision, anderer Entscheidungsinhalt, veraltete oder zukünftige Signaturen abgewiesen.
- Server-Endpunkttest: Nur aktive voneinander verschiedene Personen, aktive Schlüssel und verbrauchter Owner-Proof; keine Selbstfreigabe, keine automatische Owner-Aktivierung.
- **730/730 Node-Tests bestanden**, mit begrenzter Parallelität, einschließlich zehn neuer Signatur-/SQL-Vertrags-/Edge-Negativtests.
- **295/295 Rust-Library-Tests bestanden**, acht planmäßig ignoriert; Rust-Code wurde in Gate 9 nicht geändert.
- TypeScript-DOM-Check der Edge-Funktion und kompletter TypeScript/Vite-Build erfolgreich (1.909 Module); bestehender Bundle-Chunk-Größenhinweis ohne Abbruch.
- Supabase-Sicherheitsberater: für das neue server-only Schlüsselregister lediglich `rls_enabled_no_policy` (INFO, gewollt). Weitere Warnungen aus der vorhandenen Datenbankumgebung bleiben bestehen und wurden nicht als bereinigt ausgegeben.
- Lokale Migration `20261105100122` mit der echten Supabase-Historie abgeglichen, um doppelte Ausführung beim künftigen DB-Push zu vermeiden.
- Tests ändern keine echten Berechtigungstabellen und erzeugen keinen administrativen Projektstatus.
- Beta bleibt **gesperrt** bis Reviewer-Key-Onboarding, unabhängigem nativen Signatur-Readback, vollständigem authentifiziertem KATOOS→Owner→Reviewer→GitHub-CI→Ledger-End-to-End und signierter Geräte-/Mesh-Abnahme. `verifiedPercent=null`, keine echte ETA.
