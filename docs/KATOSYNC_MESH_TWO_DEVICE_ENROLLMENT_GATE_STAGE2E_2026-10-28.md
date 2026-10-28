# KatoSync Mesh – Stage 2E: beide Geräte serverseitig enrolled, zusätzlich lokale Zustimmung

Stand 28.10.2026. **Native Vorbereitung – nicht produktiv verbunden oder freigegeben.**

## Warum diese Stufe notwendig ist

Der Stage-2C-Hardware-Test beweist korrektes gegenseitiges TLS zwischen
synthetischen Ed25519-Testidentitäten. Stage 2D begrenzt den zukünftigen
Verbindungsaufbau auf ein online verifiziertes KATOOS-Konto und einen
**explizit lokal gespeicherten** Peer-Keychain-Pin. Ohne Gegenprüfung am
Enrollment-Backend könnte ein rein lokal eingetragener, später serverseitig
widerrufener Peer dennoch eine einmalige mTLS-Probe auslösen.

## Implementierte modulare Ergänzung

- `src-tauri/src/mesh_enrollment_gate.rs` ist ein **read-only**
  Backend-Validator. Er holt über den bestehenden Supabase-JWT nur
  die öffentlichen Geräte-Schlüssel, Owner-IDs, Fingerprints und
  Enrollment-/Revocation-Informationen aus der **fest vorgegebenen**
  `katosync_mesh_devices`-Tabelle. Die Query ist owner-gefiltert und
  zusätzlich durch bestehende owner-only-SELECT-RLS begrenzt.
- Nur wenn **beide** exakten Ed25519-Schlüssel unter dem selben online
  verifizierten Konto registriert und nicht widerrufen sind, wird
  die Stage-2D-Einmalprobe für diesen zusätzlichen Gate freigegeben.
- Der Validator verwirft gemischte Owner, falsch formatierte oder
  manipulierte Schlüssel, unpassende SHA256-Fingerprints, doppelte
  Schlüssel, fehlerhafte oder zukünftige Enrollment-Zeitpunkte,
  unbekannte Membership-States sowie fehlende oder widerrufene
  erforderliche Geräteeinträge. Maximal 10 Records und 16 KiB Antwort.
- Der Trust-Gate prüft weiterhin **unabhängig** den im OS-Schlüsselbund
  gespeicherten, nach signiertem gegenseitigem SAS explizit bestätigten
  Peer-Pin. `discovered`, `pending` oder `trusted` als DB-Status
  reichen **nie** allein für eine Mesh-Peer-Zulassung aus.
- `mesh_admission.rs` prüft vor und nach einer einmaligen TLS-Probe
  Enrollment plus Konto plus lokalen Pin. Nach der Probe muss auch
  die **eigene** Keychain-Identität dieselbe geblieben sein.
- QA-only über `katoos-auth-qa`, ohne Tauri-IPC, Socket-Listener,
  automatische Registrierung, Remote-Jobs, DB-Schreibzugriff
  oder UI-Statuswechsel. Ein fehlender Internet-/DB-Nachweis bedeutet
  **Abbruch**, nicht offline permissiv weiterarbeiten.
- Keine zusätzlichen JS/React-Seiteneffekte; die UI bleibt Darstellung
  und Bedienung. Business- und Sicherheitslogik liegen ausschließlich
  in den passenden nativen Rust-Modulen.

## Live-Bestand verifiziert: Datenbank-Gate noch geschlossen

Am 28.10.2026 wurden über die **verbundene Supabase-Instanz**
`KatoOS (old Cirqa)` (EU Central) ausschließlich **read-only**
Migrationsmetadaten und Tabellenexistenz geprüft.
Die in Git vorhandenen Migrationen
`20261027153306_mesh_device_registry_fail_closed.sql`,
`20261028081746_mesh_device_enrollment_challenge.sql` und
`20261028115220_mesh_owner_private_realtime_signaling.sql`
erscheinen **nicht** in der angewendeten Migrationsliste.
Die PostgreSQL-Metadatenprüfung per `to_regclass(...)` ergab für
`katosync_mesh_devices`, `katosync_mesh_owner_policy`,
`katosync_mesh_enrollment_challenges` und `katosync_mesh_invites`
jeweils **NULL**: Die nötigen Tabellen fehlen im derzeit verbundenen
KATOOS-Backend. Die anschließend über das Supabase-Konto ausgelesene
Liste der aktiven Edge Functions enthält lediglich
`kai-response` und `kai-response-secure`; die im Repository
vorbereitete `mesh-device-enrollment`-Function ist also ebenfalls
**noch nicht deployed**. Es wurden keine personenbezogenen Datensätze
gelesen und keine Edge-Function-Änderung vorgenommen.

**Konsequenz:** Der neue Enrollment-Validator lehnt den tatsächlichen
Verbindungsaufbau ordnungsgemäß ab (`MESH_ENROLLMENT_UNAVAILABLE`).
Das ist ein notwendiges Fail-Closed-Verhalten, kein Mesh-Erfolg.
Es wurden **keine** Migrations-, RLS-, Edge-, Runtime- oder
Datenbankänderungen durchgeführt. Ein späteres isoliertes Rollout
braucht zuerst einen Security-Review der Migrationen, die Entscheidung
für die QA-Zielumgebung und einen Live-RLS-/Enrollment-Negativtest.

## Was dieser Schritt NICHT beweist

- Noch **kein echter M2↔M3-End-to-End-Enrollment-Lauf** gegen den
  KATOOS-Backendbestand und keine Online-Verifizierung, dass die
  notwendige SQL-Migration in der produktiven Datenbank bereits
  ausgeführt wurde.
- Kein Owner-Passkey-Step-up, keine automatische oder servergestützte
  SAS-Abstimmung. Der bisherige manuelle bidirektionale Codevergleich
  bleibt separat erforderlich.
- Keine aktive Mesh-Session, kein Konto-/Widerrufs-Eventstream, kein
  Discovery-/Reconnect-Daemon und kein Remote-Job. Eine dauerhafte
  Verbindung benötigt verbindliche Revoke-/Logout-/Lease-/Timeout-
  Steuerung, die eine einmalige Vor-/Nachprüfung nicht ersetzen kann.
- Es wurden keine realen Nutzerkonten, Schlüssel, Tokens oder Geräte-
  IDs in Code, Tests oder Dokumentation aufgenommen.

## Prüfpunkte für die nächste QA-Freigabe

1. Betreiberseitig bestätigen, dass Registry-Schema, owner-only-RLS,
   Enrollment-Challenge und Complete-Endpoint auf dem isolierten
   KATOOS-QA-Projekt korrekt funktionieren; keine Migrations- oder
   Datenbankänderung im Rahmen dieser PR.
2. Im expliziten KATOOS-QA-Account **auf beiden Geräten** den lokalen
   Ed25519-Besitz nachweisen und die Registry-Einträge erzeugen;
   jeden Datensatz mit Owner, Public Key und Fingerprint überprüfen.
3. Signierte gegenseitige Challenge/Response und übereinstimmenden
   12-stelligen SAS auf **beiden** Geräten manuell bestätigen.
4. Erst danach echte Pins gegen mTLS testen; ungültige Konten,
   Key-Rotation, Roster-Revocation und SAS-Abbruch ablehnen.
5. Aktive Sessions überwachen und bei Revocation/Logout trennen,
   bevor eine UI überhaupt den Status `connected` zeigen darf.

**Sicherheitsmodell:** Registry-Enrolment (Keybesitz) UND lokales
Zwei-Wege-SAS-Trust-Pinning UND Online-Kontobindung UND mTLS sind
notwendige, aber für langlebige Remote-Ausführung noch nicht
hinreichende Voraussetzungen.
