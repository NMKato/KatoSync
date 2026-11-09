# KatoSync 4.0 — Stage 4E Mesh-Entitlement & Identitäts-Härtung (QA)

**9. November 2026 – nur isolierte PostgreSQL-17-QA, NICHT produktiv deployt.**

## Live-Bestandsprüfung: rein lesend

Die aktuellen Definitionen von `katosync.mesh_device_quota_guard()` und des
`katosync_mesh_device_quota_before_insert`-Triggers wurden am 09.11.2026
über einen read-only SQL-Selektor in der echten KATOOS-Supabase-Datenbank
geprüft. Sie zeigen weiterhin `coalesce(allowed,2)` bei fehlender Policy
und keinen Ablauf-Check. Es gibt lediglich den bestehenden
**BEFORE INSERT**-Quotentrigger, keinen entsprechenden Identitäts-UPDATE-
Trigger in der abgefragten Tabelle.

**Nicht nachgewiesen:** Ein realer unautorisierter Nutzer habe in Produktion
ein Gerät registriert oder umgehängt. Tabellenrechte, Edge-Checks, RLS und
weitere Autorisierungsgrenzen können solche Zugriffe unabhängig verweigern.
Die reproduzierte Lücke betrifft eine privilegierte UPDATE-Operation
(z. B. fehlerhaften Service-Role-Code), nicht eine nachgewiesene öffentliche API.

## Isolierte Beweiskette

`bash scripts/qa-mesh-postgres-local.sh quota-stage4e-identity`

1. Erstellt ausschließlich ein frisches PostgreSQL-17-Cluster in
   `/tmp/ksmeshqa.*`, mit `listen_addresses=''`, privatem Unix-Socket
   (0700) und geprüft **keinem TCP-Listener**.
2. Lädt die bereits versionierte KatoSync-Startmigration und die unveränderte,
   seit dem 08.11. separat hashgesicherte Stage-4E-Quotenfunktion
   `tests/fixtures/migrations/20261103162500_mesh_entitlement_expiry_guard.sql`.
3. Wiederholt die vorhandenen echten SQL-Insertprüfungen:
   Free **0** bei fehlender Policy, 2-Geräte-Testpolicy, Expiry/Revocation
   deny, Pro **10**, elftes Gerät verweigert, Public-DML/Execute verweigert.
4. Reproduziert die **UPDATE-Transfer-Lücke** des INSERT-only-Standes innerhalb
   einer Transaktion: Eine privilegierte UPDATE-Operation kann eine bestehende
   Gerätedatensatz-Owner-UID ohne Quotenprüfung austauschen. Sofortiges
   `ROLLBACK` stellt den Ursprungszustand wieder her.
5. Testet innerhalb einer **neuen** Transaktion den ausschließlich
   temporären Overlay-Trigger
   `tests/sql/mesh_quota_stage4e_identity_overlay_qa.sql`:
   Immutable sind `device_id`, `owner_user_id`,
   `signing_public_key` und `fingerprint`.
   Alle vier Mutationen werden mit SQLSTATE 23514 und dem exakten
   Fehler `KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE` verweigert.
   Normale `display_name`, `membership_state` und `last_seen_at`-
   Aktualisierungen durch die berechtigte Service-Rolle bleiben möglich.
6. Überprüft fehlende Schreib-/Execute-Rechte für `anon` und
   `authenticated`. Danach `ROLLBACK` und Nachweis, dass Funktion,
   Trigger und sämtliche Testupdates vollständig zurückgenommen wurden.

Erwartete Marker:

- `KATOSYNC_STAGE4E_DISPOSABLE_INSERT_ONLY_TRANSFER_GAP_REPRODUCED`
- `KATOSYNC_STAGE4E_DISPOSABLE_IMMUTABLE_OWNER_KEY_FINGERPRINT_ID_PASS`
- `KATOSYNC_STAGE4E_DISPOSABLE_HARDENING_ROLLBACK_PASS`
- `MESH_QA_ALL_SQL_ASSERTIONS_PASSED`

**Alle vier Marker wurden im isolierten lokalen Test beobachtet.**

## Prüfprotokoll (M2, 09.11.2026)

- Echtes temporäres PostgreSQL 17 ohne TCP: **BESTANDEN**;
  einschließlich baseline-Transfer, vier Update-Denials, RLS-/Rechteprüfung,
  weiterhin erlaubten Statusänderungen und DDL-/Daten-Rollback.
- Die vier ergänzten Stage-4E-Node-Vertragsprüfungen: **4/4 bestanden**.
- Node-Gesamttests: **758/758 bestanden** (`--test-concurrency=4`).
  Ein erster Lauf während einer gleichzeitigen `npm ci`-Installation
  hatte eine fehlende `esbuild`-Abhängigkeit in einem bestehenden
  Deno-Loopback-Test; nach abgeschlossener Installation sind alle Tests
  ohne geänderte Assertion grün.
- Remote Usage: **16/16 bestanden**.
- TypeScript und Vite: **Build erfolgreich**, 1.911 Module; der bekannte
  Bundle-Chunk-Hinweis blockiert den Build nicht.
- Rust-Format, Bash-Syntax und Git-Diff-Prüfung: **bestanden**.
  Rust-Library wurde in dieser Änderung nicht modifiziert.

## Source-, Migrations- und Releaserichtlinie

Die neuen SQL-Dateien befinden sich **ausschließlich in `tests/sql/`**,
nicht in `supabase/migrations/`. Die acht historisch verschobenen QA-only
Fixtures werden nicht verändert. Das verhindert einen versehentlichen
`supabase db push` der alten oder neuen Stage-4E-Entwürfe.
Eine produktive Migration müsste durch eine separate autorisierte
Release-Änderung neu erstellt, versioniert, kryptografisch mit dem
tatsächlichen Live-Schema abgeglichen, in einer nichtproduktiven
Umgebung geprüft und nach unabhängiger Freigabe angewandt werden.

Vor produktiver Anwendung müssen zusätzlich geprüft werden:

- Privilegien und RLS: Service-Role-Schreibrechte nur hinter
  authentifizierten, owner-/device-gebundenen Edge-Verifikationen.
- Policy/Entitlement: keine Free-Fallback-Registrierung, echte aktive
  Zahlungsmethode/Trial-Berechtigung, Laufzeit/Expiry, Downgrade,
  Widerruf bei jedem Relay-/Inbox-/Remote-Job und keine Freigabe durch
  bloßes Client-Tier-Flag.
- Bereits existierende Geräte: aktueller Bestand, Lifecycle,
  Eigentümerzuordnung, Pro 10, Behandlung widerrufener Geräte.
  **Ob widerrufene Identitäten einen Slot belegen, bleibt eine explizite
  Produkt-/Sicherheitsentscheidung; der bestehende COUNT zählt alle
  Einträge.**
- Parallelität: unter konkurrierenden echten Enrollment-Transaktionen
  darf die Besitzerquote nicht überschritten werden. Der vorhandene
  advisory transaction lock darf nicht entfernt werden.
- Rollback muss restriktiv bleiben: kein erneutes `coalesce(allowed,2)`,
  keine Rückkehr zum fehlenden Expiry-Check, keine stillschweigende
  Entsperrung früher abgewiesener Geräte. Ein schlichtes Zurückspielen
  des alten Triggers wäre deshalb **kein sicherer Produktionsrollback**.
- Zeitlich gesondert: Gate9 echte unabhängige Reviewer-Abnahme,
  Gate10 Key-Pin, SAS/M2/M3-Revocation, Auth-Account-Switch, vollständige
  Test-/Auditbelege und Release-Go.
- Keine automatische Datenbereinigung, Device-Reassign, Billing-Aktivierung,
  User-/Reviewer-Registrierung, Remote-Job-Freigabe oder `main`-Merge.

**QA-Status:** Die neue Update-Härtung und ihr DDL-Rollback sind in
isoliertem PostgreSQL nachgewiesen. Die produktive KatoOS-Datenbank,
GitHub-`main`, Installationen und bereits vorhandene öffentliche
Gerätedatensätze wurden nicht verändert.
