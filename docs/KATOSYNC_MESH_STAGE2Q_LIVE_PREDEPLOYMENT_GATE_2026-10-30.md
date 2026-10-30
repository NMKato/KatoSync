# KatoSync Stage 2Q – Fail-closed Schema-/Edge-Rollout-Gate

**Stand 30.10.2026.** QA-Draft auf Stage 2P, dem PR #182. **Kein Deployment, keine Änderungen an der Live-Datenbank, keine Änderungen an den installierten M2-/M3-Apps.**

## Ausgangslage (tatsächlich read-only geprüft)

Supabase-Projekt `xbnnlyyxiilklsygxcof`, eigenes Schema `katosync`. Datenbank-Migration-History (via `supabase_migrations.schema_migrations`) enthält diese drei nötigen Basiseinträge:

1. `20261028202403_katosync_mesh_owned_schema`
2. `20261028202503_katosync_add_to_existing_exposed_schemas`
3. `20261028204216_katosync_account_membership_admission`

Alle drei zukünftigen Inbox-Migrationen fehlen noch: `20261029211243`, `20261030072543`, `20261030074910`. Tatsächlich vorhandene Edge-Dienste sind `kai-response`, `kai-response-secure`, `mesh-device-enrollment`; **nicht** `mesh-inbox-send` oder `mesh-inbox-receive`.

Read-only-Abfrage der katosync-Daten: **2 discovered, 0 trusted, 0 invites, 0 resolved, 1 Eigentümer, 0 revoked, 0 fehlende Signing Keys**. `service_role` besitzt derzeit UPDATE auf `mesh_invites`, `authenticated` hat noch owner-RLS-geschützte SELECT-Berechtigung auf diese Tabelle. Die Stage-2O-Migration entfernt diese direkte Tabellenleseberechtigung zugunsten gerätegebundener Edge-Abfrage.

## Neues Werkzeug

`scripts/qa-mesh-inbox-rollout-gate.mjs` arbeitet **vollständig offline**. Es führt **keine** Supabase-API-Aufrufe und keine SQL-, SSH-, Edge- oder GitHub-Schreiboperationen aus. Die Eingabe ist ein absichtlich nicht sensitiver JSON-Snapshot, der *zuvor unabhängig per read-only Supabase-MCP/SQL und Edge-Inventar* erhoben wurde.

Der Prüfer kontrolliert:
- Exaktes Supabase-Projekt, Namen/Versionen der drei Basis-Migrationen und das Fehlen oder die vollständige Anwesenheit der drei neuen Inbox-Migrationen
- SHA-256-Fingerprints der drei bisher im Review gesicherten SQL-Migrationen; jede Änderung macht die Freigabe erneut prüfpflichtig
- Beidseitige Edge-Code-Flags, native Rust-Compile-Time-Flags, UI-QA-Flags sowie die Proof-ID-Bindung vor dem Datenbank-Update
- Stand und Berechtigungen für `mesh_invites`, `mesh_inbox_proofs`, RLS und Service-Role-UPDATE
- Genau die zwei erwarteten nicht vertrauten Testgeräte desselben Owners sowie keine Bestands- oder Legacy-Einladungen
- Zwei explizite Modi: `baseline` (vor Migration) und `schema-staged` (vollständig installierte Migrationen plus beide Edge-Dienste). Teildeployments, fremdes Projekt, geänderte SQL-Fingerprints, unzulässige Client-Grants oder unplausibler Gerätezustand werden **blockiert**

Die Ausgabe `BASELINE_MATCHES_REVIEW_ONLY` bzw. `STAGED_SCHEMA_REVIEW_ONLY` ist **keine** Freigabe zur automatischen Installation, zum Öffnen von QS-Flags, zur Kopplung oder für Remote-Jobs. Der Status enthält weiterhin ausdrücklich `connected=false`, `remoteJobsEnabled=false`, `remoteSessionReady=false`.

## Belegter Testlauf

Der aus echten read-only-Abfragen am 30.10.2026 erhobene Snapshot bestand:

`node scripts/qa-mesh-inbox-rollout-gate.mjs --phase baseline --snapshot /tmp/katosync-stage2q-live-baseline-20261030.json`

Ergebnis: **`BASELINE_MATCHES_REVIEW_ONLY`**, **2 erkannte Geräte, 0 Einladungen, 0 trusted, 0 neue Inbox-Migrationen**.

Der lokale PostgreSQL-17-Test mit *wirklich ausgeführten, aufeinander aufbauenden* Migrationen bestand erneut: `bash scripts/qa-mesh-postgres-local.sh inbox-proof` → **`MESH_INBOX_RESOLUTION_PROOF_BINDING_PASS`** und **`MESH_QA_ALL_SQL_ASSERTIONS_PASSED`**. Dieser PostgreSQL-Test läuft in einem temporären, nur per Unix-Socket zugänglichen Cluster und verändert Supabase nicht.

## Späteres QA-Rollout – erst nach gesondertem Release-Sicherheitsreview

1. Vorherigen vollständigen Stand samt RLS, Rollenrechten, Migration-History und Edge-Inventar unabhängig read-only erneut erfassen. Wenn die Daten abweichen, kein automatischer Write.
2. Prüfen, ob die SQL-Schemaänderungen mit dem aktiven KATOOS-Projekt kompatibel sind. Besonders wichtig: Stage 2O nimmt authentifizierten Clients die bisherige direkte `mesh_invites`-Leseberechtigung. Deshalb ältere App-Versionen und Regressionen prüfen.
3. Nach Freigabe die Migrationen **streng in dieser Reihenfolge** (und **ohne** Seed, DB-Reset, Repair oder automatische Datenlöschung) kontrolliert auf einem explizit bezeichneten QA-Ziel installieren:
   - `20261029211243_mesh_inbox_signed_send_guard.sql`
   - `20261030072543_mesh_recipient_signed_inbox_atomic_decisions.sql`
   - `20261030074910_mesh_resolution_proof_binding.sql`
4. Danach separate Edge-Deployments `mesh-inbox-send` und `mesh-inbox-receive`. Die Edge-Serverflags bleiben bis zur sicheren Abnahme standardmäßig aus: `KATOSYNC_MESH_INBOX_STAGE=send-only` sowie `KATOSYNC_MESH_INBOX_RECEIVE_STAGE=qa-inbox` **erst in bewusst freigegebenem QA-Zeitfenster**.
5. Native QA-Binärdatei braucht zusätzlich compile-time `KATOSYNC_MESH_INBOX_SEND_QA=1` / `KATOSYNC_MESH_INBOX_RECEIVE_QA=1` und Frontend `VITE_MESH_INBOX_SEND_QA=1` / `VITE_MESH_INBOX_RECEIVE_QA=1`, dazu bestehendes `katoos-auth-qa`-Feature und KATOOS-Auth-QA-Flag. Die Standard-App bleibt gesperrt.
6. Wiederholte read-only Nachprüfung (`--phase schema-staged`) und dann **erst** ein echter M2→M3-Invite mit klarer Zustimmung und negativer Sicherheitsabnahme. Das genehmigt noch keine Mesh-Transport-Sitzung.
7. Beidseitiges SAS und reale, voneinander bestätigte Key-Pins mit mTLS und Revocation-Watcher bleiben unabhängige Freigabegates. Writer bleiben gesperrt.

## Sicherer SQL-Abfragevertrag (nur SELECT)

Für die Snapshot-Daten verwenden wir nur Aggregationen, `information_schema`, `pg_catalog`, `has_table_privilege`, `supabase_migrations.schema_migrations` und das Edge-Funktionsinventar. Personen-IDs, Zugriffs-Tokens, Geräte-Schlüssel und Secrets werden **nicht** in den JSON-Snapshot kopiert.

**Rest-Risiko:** Die aktuelle Eingabe ist ein vom Bediener übernommener Snapshot und daher nur so aktuell/vertrauenswürdig wie die vorausgehende separate read-only-Erhebung. Ein Offline-Test kann weder aktive Serverflags noch reale Gerätefreigaben allein beweisen. Für produktive Freigabe sind außerdem ein echtes `supabase db push --dry-run`, eine vollständige Berechtigungs-/Migrationsprüfung und ein separater Owner-Releaseentscheid erforderlich.

**Status:** Live-Baseline nachgewiesen, lokale Migrationstests bestanden, echter Inbox-Workflow noch nicht deployed, echte M2/M3-Verbindung weiterhin nicht hergestellt.

## Korrektur / Erweiterung nach Stage 2S (30.10.2026)

Die obige Beschreibung mit **drei** Inbox-Migrationen ist ein historischer Stand von Stage 2Q und wurde durch Stage 2S erweitert. **Aktuelle verbindliche Reihenfolge: vier Inbox-Migrationen**, zuletzt `20261030093323_mesh_inbox_recipient_key_continuity.sql`. Der Predeployment-Prüfer hat dafür eine zusätzliche lokale SHA-256-Prüfung sowie die Pflichtfelder `proofKeyColumn`, `proofKeyConstraint`, `proofKeyInsertTrigger`, `proofKeyResolutionTrigger` erhalten. Ein nach Stage2O.1 stehengebliebener Schema-Stand darf **nicht** als für echten Inbox-E2E bereit angesehen werden. Siehe `KATOSYNC_MESH_STAGE2S_RECIPIENT_KEY_CONTINUITY_2026-10-30.md`.
