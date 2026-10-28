# KatoSync Mesh – Stage 2F: isolated PostgreSQL RLS & enrollment QA

Status: 28.10.2026 – **isoliertes, lokales Migrations-QA**, kein Cloud-Rollout.

## Motivation

Der mit dem Supabase-Konnektor verifizierte KATOOS-Bestand
`xbnnlyyxiilklsygxcof` hat Stand 28.10.2026 keine Tabellen
`katosync_mesh_devices`, `katosync_mesh_owner_policy`,
`katosync_mesh_enrollment_challenges`, `katosync_mesh_invites`
und keinen bereitgestellten Edge-Service `mesh-device-enrollment`.
Ein tatsächliches M2↔M3-Enrollment bleibt daher blockiert.

**Keine Migration wird bei diesem QA-Lauf auf KATOOS angewandt.**

## Reproduzierbarer Test ohne bestehende Daten

`./scripts/qa-mesh-postgres-local.sh` startet PostgreSQL 17 **ausschließlich
innerhalb eines neu angelegten temporären lokalen Clusters** mit Unix-Socket
in einem `0700`-Verzeichnis; TCP-Netzwerk-Listener sind explizit deaktiviert.
Der Test bricht ab, falls der QA-Port dennoch per TCP erreichbar wäre.
Nach jedem Durchlauf stoppt er den PostgreSQL-Prozess und löscht Cluster,
Socket und QA-Daten. Es werden **keine** Supabase-Secrets, Cloud-Konten,
bestehenden lokalen Datenbanken oder produktiven Geräteidentitäten verwendet.

Der Postgres-Test `tests/sql/mesh_registry_backend_qa.sql` stellt
minimal die für Migrationen notwendigen `auth`-/`realtime`-Rollen,
Funktionen und Tabellen bereit, führt **genau die drei bereits vorhandenen**
KatoSync-Mesh-Migrationen in der Repository-Reihenfolge aus und testet:

- alle vier `public`-Mesh-Tabellen haben RLS;
- `authenticated` und `anon` besitzen keine direkten Mesh-Schreibrechte,
  `anon` kann die privaten Registry-Daten nicht lesen;
- der erste Nutzer sieht nur seine Geräte, Policy und Invites, niemals die
  des zweiten Nutzers; der zweite Nutzer sieht umgekehrt nur sein Gerät,
  ohne bestätigten Owner-JWT gar nichts;
- der serverseitige Free-Quota-Trigger blockiert einen dritten
  Geräte-Eintrag (2 erlaubte Geräte);
- der serverseitige Challenge-Trigger blockiert die vierte
  Challenge innerhalb einer Minute (3 zulässig);
- Realtime-Policies gewähren eigenes Broadcast-Thema, verweigern
  fremdes Konto und anonymen JWT ausdrücklich.

Die Simulation bildet nicht den vollständigen Supabase-JWT-Validator,
Realtime-Laufzeitdienst oder echte gleichzeitige Transaktionen nach.
Sie ersetzt **keine** echte externe Sicherheitsprüfung oder
Cloud-RLS-Abnahme.

## Zusätzliche Edge-Sicherheitskorrektur

Der Enrollment-Complete-Handler prüft nun bei bereits registriertem
Ed25519-Key zusätzlich serverseitig `membership_state` und
`revoked_at`. War das Gerät widerrufen, antwortet er mit
`403 DEVICE_REVOKED`, bevor er die Einmal-Challenge konsumiert
oder eine Registrierungsbestätigung sendet. Ein erneuter
Key-Besitznachweis **darf keine frühere Revocation aufheben**.
Die Node-Fixture prüft sowohl dieses Negativszenario als auch, dass
ein bereits vertrauter, nicht widerrufener Eintrag nicht herabgestuft wird.

Die reine Fachregel liegt getrennt vom HTTP-Handler im Modul
`supabase/functions/mesh-device-enrollment/registry-policy.ts`. Die
zugehörigen Tests prüfen zusätzlich inkonsistente, gefälschte oder
doppelte Registry-Einträge. Damit bleiben Datenzugriff, Protokoll und
Sicherheitsregeln getrennt und gezielt wartbar.

## Tatsächliche lokale Prüfergebnisse

Am 28.10.2026 auf dem M2: **322 Node-Tests bestanden, 0 fehlgeschlagen**;
`npm run build` einschließlich TypeScript-Compile erfolgreich;
`npm run test:mesh-postgres-local` mit allen drei bestehenden Migrationen,
RLS-Isolation, DML-Sperren, Quota-/Challenge-Triggern und Realtime-
Negativfällen erfolgreich. Der Web-Build weist noch die bekannte
Hinweismeldung zu großen Bundles auf; das ist kein Mesh-QA-Fehler.
Die PostgreSQL-Prüfung wurde wiederholt, der Testcluster jedes Mal
beendet und entfernt.

## Nächste Gates vor Cloud-Deployment

1. Migrationen inklusive SQL-Sicherheitsprüfung und Edge-Gates reviewen;
   keine produktiven KATOOS-Änderungen nebenbei.
2. Isolierte authentifizierte Backend-QA-Umgebung festlegen und
   Migrationen mit RLS- und Owner-Negativtests ausrollen. Die aktuell
   verbundene KATOOS-Instanz ist **kein** isolierter QA-Cluster.
3. Kurzlebige Enrollment-Challenge- und Complete-Funktion samt
   serverseitigem Quota-/Replay-Schutz deployen und verifizieren.
   Service-Role bleibt ausschließlich auf dem Edge-Server.
4. Erst nach Backend-Abnahme beide echten Macs mit ihren
   **eigenen** Keychain-Identitäten registrieren; manuell signierte
   SAS-Freigabe auf beiden Seiten; dann einmaliger echter mTLS-Probe.
5. Revoke-/Logout-Watcher, Short-Lived-Session-Leases und
   Berechtigungsnachweise vor Remote-Jobs / Connected-UI ergänzen.

Diese QA-Arbeiten verändern **weder** die Tauri-UI noch installierte
KatoSync-Apps, Cloud-Infrastruktur, lokale Keychains oder Remote-Job-Rechte.
