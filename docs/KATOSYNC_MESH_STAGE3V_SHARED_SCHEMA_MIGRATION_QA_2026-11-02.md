# KatoSync Stage 3V – bestehendes KATOOS-Schema: Migrations-QA und Freigabe-Gate

**02.11.2026 · NMKato Solutions · gestapelter Draft auf Stage 3U · kein Cloud-Deploy**

## Live-Inventur (ausschließlich lesend)

Das bereits produktiv vorhandene KATOOS-Supabase-Projekt enthält im Schema `katosync` die fünf RLS-geschützten Tabellen `account_memberships`, `mesh_devices`, `mesh_enrollment_challenges`, `mesh_invites`, `mesh_owner_policy`. Zum Prüftermin: **ein Membership-Datensatz, zwei Geräte, null Trusted, null Revoked, null Einladungen**. Es fehlen sowohl die Inbox-Proof-Tabelle und die zwei Relay-Tabellen als auch `mesh_invites.dispatch_signature`. Die drei Basis-Migrationen stehen in der Cloud-Migrationshistorie; die folgenden fünf **nicht**.

Rechte laut Cloud-Audit: kein `anon`-Schemazugriff, keine anonymen Inbox-Leserechte, `authenticated` kann die eigene Membership/Geräte lesen und derzeit noch `mesh_invites`, `service_role` darf Einladungen schreiben. Diese Bestandswerte sind eine Momentaufnahme, **kein** dauerhaftes Deployment-Ticket.

## Reproduzierbarer QA-Beweis auf PostgreSQL 17

`bash scripts/qa-mesh-postgres-local.sh shared-rollout` startet einen ausschließlich Unix-Socket-gebundenen wegwerfbaren PostgreSQL-Cluster ohne TCP und löscht ihn anschließend. Der Modus führt alle fünf noch ausstehenden Migrationsdateien in der vorgesehenen Reihenfolge aus; dann die bereits vorhandene Membership-Migration als synthetische Baseline. Die Prüfung hat **acht geschützte KatoSync-Tabellen**, keine anonymen oder direkten Inbox-/Relay-Leserechte, fortbestehende KATOOS-`auth.users`-Verweise und korrekt beschränkte Service-Rechte bestätigt.

Mit echter Postgres-RLS und Rollenwechseln werden drei isolierte Fälle geprüft: aktiver Eigentümer sieht ausschließlich eigene Geräte und aktive Mitgliedschaft, zweiter Eigentümer sieht ausschließlich die eigene ausstehende Mitgliedschaft und sein Gerät, unberechtigter Dritter sieht nichts. Selbst-Promotion und direkter Inbox-Lesezugriff werden abgewiesen. Vorher durchlaufen Challenge/Response, Einladung, Relay-Replay, Rate-Limit und Widerruf die bestehenden SQL-Negativtests. `STAGE3V_SHARED_KATOOS_SCHEMA_COMPAT_PASS` und `MESH_QA_ALL_SQL_ASSERTIONS_PASSED` bestätigen die lokale Abnahme.

`node scripts/qa-mesh-shared-rollout-stage3v.mjs` überprüft die SHA-256-Prüfsummen **aller acht** relevanten Migrationen. Ein optional übergebener JSON-Snapshot wird ausschließlich offline geprüft: Projektkennung, Baseline-Migrationen, Nullstand sämtlicher fünf Pending-Migrationen, erwartete fünf Tabellen, Einladungsfreiheit, Trust-Zustand, Rollenrechte und bisher nicht bereitgestellte Inbox-/Relay-Endpunkte. Das Gate darf **niemals** selbst Deployments oder Migrationen ausführen und liefert ausschließlich `canDeployAutomatically:false`.

## Reihenfolge für eine später ausdrücklich genehmigte Cloud-Abnahme

1. Ein frisches, **lesendes** Live-Inventar abrufen (Migrationshistorie, Tabellen, Rechte, Einladungen und Trust-Zustand); jede Abweichung ist ein NO-GO.
2. Vor produktiven Schemaänderungen dokumentiertes PostgreSQL-Backup/PITR und eine erfolgreiche Wiederherstellungsübung nachweisen. Ein Schema teilt Ressourcen und Ausfallrisiken mit KATOOS.
3. Echte KATOOS-/KatoSync-Online-Sitzung mit serverseitiger aktiver `account_memberships`-Berechtigung und vollständig gepinntem Issuer überprüfen; niemals Legacy-/Preview-Refresh-Tokens wiederverwenden.
4. In kontrolliertem Wartungsfenster Einladungs-Schreibzugriffe bis zur Migration anhalten. Der erste SQL-Schritt fügt `dispatch_signature NOT NULL` **ohne Default** hinzu und wäre bei inzwischen vorhandenen Einladungseinträgen nicht ohne Datenmigration anwendbar.
5. Die fünf versionierten Migrationen nur nach expliziter Freigabe in Reihenfolge anwenden. Keine lose ausgeführten SQL-Halbstände, keine unüberprüften Änderungen an `public` oder KATOOS-`auth`.
6. Post-Migrations-RLS, FK/Trigger, tatsächliche Rollenrechte und Replay-Schutz prüfen, danach genau die erforderlichen Edge-Funktionen und QA-Flags nach eigener Sicherheitsabnahme bereitstellen.
7. Erst danach signierte **separate** QA-Builds auf M2 und M3, echte KATOOS-Login-/Geräte-Challenge, manuelle SAS-Zustimmung, mTLS, Widerruf und später die ersten read-only Aufträge testen.

**Release-Status:** Keine Live-Migration ausgeführt; keine Edge-Funktion aktiviert; Pairing und Remote-Jobs bleiben NO-GO. Die schon installierten QA-Apps bleiben unverändert.

## Nächster Blocker

Die fünf Migrationen sind **lokal technisch konsistent**, aber daraus folgt noch keine Online-Freigabe: Der neue Stage3U-Preflight und die Inbox-/Relay-Edge-Funktionen benötigen erst einen signierten QA-Build, online-verifizierte KATOOS-Sitzung, autorisierte Geräte und geprüfte Backend-Rollen. Beta-Blocker für lokalen Chat und Provider-Aufträge bleiben davon unabhängig.
