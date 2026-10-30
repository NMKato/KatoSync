# KatoSync Mesh – Stage 2X: Laufzeit-Sperre und kontrollierter Wiederherstellungsplan

**Stand: 30. Oktober 2026, 13 Uhr (Berlin).** Folgeentwicklung auf Stage 2W / [Draft-PR #189](https://github.com/NMKato/KatoSync/pull/189). **Keine Änderung an Supabase-Live, Auth, Keychain, Mac-Apps oder den zuvor gepinnten Migrations- und Edge-Quelldateien.**

## 1. Echte Edge-Einstiegspunkte ohne Netz und ohne Zugriffsrechte ausführen

`tests/meshInboxEdgeEntrypointRuntime.test.ts` transpilert/bündelt **die echten** `supabase/functions/mesh-inbox-send/index.ts` und `mesh-inbox-receive/index.ts` mitsamt allen originalen Imports vollständig im Arbeitsspeicher. Anschließend registriert ein minimaler, hermetischer Deno-Stub die tatsächlichen `Deno.serve`-Handler und führt sie in der Node-Web-Request-Laufzeit aus. `fetch` ist im Test ausdrücklich gesperrt; schon ein einziger externer Abruf ist ein Testfehler.

Über beide Dienste werden die folgenden **tatsächlich ausgeführten** negativen Szenarien geprüft: keine Umgebungswerte, Standardwerte ohne Stage-Flag, leeres Stage-Flag, falsches Stage-Flag, fremde Supabase-Origin, korrektes Stage-Flag ohne Server-Secret, GET statt POST, POST ohne Authentifizierung und formal fehlerhaftes POST mit synthetischem Bearer. Nach jedem Szenario muss der Netzwerkzähler **null** sein.

- Ohne Aktivierung/Secrets/feste Origin: **503 `INBOX_NOT_CONFIGURED`** und `Cache-Control: no-store`.
- Falsche Methode: **405 `METHOD_NOT_ALLOWED`**.
- Keine Anmeldung: **401 `LOGIN_REQUIRED`**.
- Formal falsches Payload: **400 `BAD_INVITE` / `BAD_PROOF`**.
- **Wichtig:** Das ist echte Ausführung der Edge-Handler im Node-Web-Standard mit Deno-`serve`-Shim; **nicht** eine native Supabase-Edge-/Deno-Plattformprobe, kein PostgREST-Live-Test, kein JWT-E2E. Die produktive Plattform-JWT-Verifizierung selbst wird dadurch nicht bewiesen.

Die beiden Einstiegspunkte bleiben unverändert und werden zusätzlich vom Stage-2W-Paketprüfer byte-genau SHA256-kontrolliert.

## 2. Baseline und betroffene Infrastruktur

Read-only beobachtet am 30.10.2026: Supabase-Projekt `xbnnlyyxiilklsygxcof` (`KatoOS (old Cirqa)`), Region `eu-central-1`, PostgreSQL 17, **ACTIVE_HEALTHY**. Nur `main` ist als Supabase-Branch vorhanden; **kein separater QA-Branch**. Das Projekt ist mit KATOOS geteilt, deshalb sind Auswirkungen auf andere Anwendungen zu berücksichtigen.

- **Mesh-Baseline**: 2 `discovered`, 0 `trusted`, 0 `revoked`, 1 Owner, 0 Einladungen, 0/4 neue Inbox-Migrationen, Proof-Tabelle nicht vorhanden.
- `mesh_invites` und `mesh_devices`: RLS aktiv. `authenticated`: `mesh_invites` SELECT derzeit erlaubt, INSERT und UPDATE nicht. `service_role`: UPDATE auf `mesh_invites` erlaubt.
- In der Cloud existieren bisher nur die drei bekannten Funktionen `kai-response`, `kai-response-secure` und `mesh-device-enrollment`; die beiden neuen Inbox-Dienste **fehlen**.
- **Nicht nachgewiesen:** aktueller tatsächlich wiederherstellbarer Backup-/PITR-Restorepunkt, letzte erfolgreiche Restore-Probe, möglicher Service-Ausfall, gesondertes Betreiber-OK. Eine bestehende Backup-Funktion wird **nicht vorausgesetzt**.

## 3. Freigabeentscheidung – vor der ersten produktiven SQL-Änderung

Für den **gemeinsam genutzten Hauptbranch** gilt standardmäßig **NO-GO**. Vorher sind erforderlich:

1. **Unabhängige Operatorfreigabe** für genau das Projekt sowie die vier exakt geprüften SQL-Dateien in der Reihenfolge 2L → 2O → 2O.1 → 2S und anschließend die beiden Edge-Funktionen (JWT-Prüfung **an**, Stage-Flags **aus**). Die Genehmigung nennt ausdrücklich das Wartungsfenster und einen Ansprechpartner bei KATOOS.
2. **Nachgewiesene Wiederherstellbarkeit:** aktueller Dashboard-Status unter `Database → Backups`; Datum/Uhrzeit des letzten verfügbaren Restorepunkts, PITR nur wenn tatsächlich aktiviert, erlaubter Datenverlust (RPO), Wartungs-/Ausfallfenster (RTO), geprüfter Export/Recovery-Verantwortlicher. Ohne belegte Recovery-Möglichkeit **keine Migration**.
3. Bei vertretbaren Kosten **vorzugsweise isolierter QA-Branch oder gesondertes Projekt**; das Projekt hat derzeit keinen QA-Branch. Einen Branch nicht ohne gesonderte Kostenfreigabe erstellen. `Restore to New Project` ist ebenfalls nicht automatisch eine exakte Umgebungskopie: Edge-Funktionen, API-Keys, Storage-Objekte und Konfiguration müssen getrennt geprüft werden.
4. **Preflight frisch auslesen**, nicht aus einer alten JSON-Datei: Hash-Pins der vier SQL- und fünf Edge-Dateien; Snapshot-Gate für 2 Owner-Devices/1 Owner/0 Invites/0 Trusted; aktuelle RLS- und Rollenrechte; kompletter PR-Stack auf exaktem Head in Windows/Web/Rust grün; Backupnachweis zugeordnet. `REVIEW_ONLY_NO_DEPLOYMENT` bleibt ausdrücklich keine Bereitstellungsfreigabe.
5. Den direkten Clientzugriff (zuvor SELECT auf `mesh_invites`) und die in 2O vorgesehene Rechteänderung unabhängig prüfen; Änderungen könnten ältere Clients betreffen. Anwender-/API-Kompatibilität vorab in einem isolierten Testsystem bestätigen.

## 4. Kontrollierte Bereitstellung und Zwischenhalte – keine Automatik

| Halt | Zulässige Handlung nach Operatorfreigabe | Verifikationsbedingung |
|---|---|---|
| A | Frische Backups/RTO/RPO, exakten Git-Head, DB-Baseline und unabhängige Freigabe protokollieren | **Go** nur wenn sämtliche Nachweise vorliegen |
| B | Nacheinander **nur** die vier explizit geprüften Migrationen durchführen; keine globale `db push`-Blindfreigabe | Nach jeder Stufe Migration registriert, keine unerwarteten Grants/Einladungen/Trust-Änderungen |
| C | Proof-RLS, Trigger, Key-Continuity-Constraints, SELECT/INSERT/UPDATE-Sperren und Service-Rollen im neuen Schema kontrollieren | Bei Abweichung **Stopp** – noch keine Edge-Freigabe |
| D | Nur `mesh-inbox-send` und `mesh-inbox-receive` mit `verify_jwt=true` bereitstellen; **ohne** aktivierte Stage-Flags | Ungültiges JWT blockiert; POST mit gültigem Auth-Kontext liefert im deaktivierten Zustand `503 INBOX_NOT_CONFIGURED`; keine Writes |
| E | Getrenntes, explizit genehmigtes QA-Zeitfenster für die Stage-Flags und Keychain-Tests, jeweils nach Security-Review | Auf beiden Macs tatsächliche Auth/Membership, Ed25519-Proof und manuelle beidseitige SAS-Beobachtung; **noch keine Remote-Jobs** |

**Wichtig:** Plattform-JWT-Verification/Secrets gehören auf den Server. Niemals `--no-verify-jwt`, keinen `service_role`-Schlüssel an die Desktop-App, niemals `--prune` verwenden. Bei jeder Schema- oder Laufzeitabweichung **sofort abbrechen** und Zustand mit bestehenden Werkzeugen **nur lesend** dokumentieren.

## 5. Notfallreaktion: kein automatisches Datenbank-Rollback

**Vor Aktivierung:** Solange Stage-Flags aus sind, verweigern die neuen Edge-Handler POST-Anfragen (503), auch wenn sie bereits bereitgestellt sind. Eine Migration kann jedoch bereits bestehende Grants verändern; das erfordert eine eigene Kompatibilitätsprüfung.

**Nach Aktivierung:** Zuerst beide spezifischen Stage-Flags wieder deaktivieren bzw. die autorisierten Betreiber-Controls anwenden, dann tatsächliche 503-/JWT-Sperre prüfen. Keine Remote-Befehle, keine Trust-Automation. Laufende Anfragen dürfen nicht ohne gesonderte Abnahme als unterbrochen gelten. Parallel bestehende Live-Daten, Fehler und Logs sichern, ohne Schlüssel offenzulegen.

**Bei SQL-Abweichung:** Keine automatischen `DROP COLUMN`, `DROP TRIGGER`, `DELETE` oder pauschales `supabase migration repair`/Rollback. Ein **gezieltes Vorwärts-Fix-Migration** mit separatem Review kann risikoärmer sein als ein globaler Restore. Weder vorhandene Einladungen noch alte Auth-Zustände dürfen durch blindes Zurückspielen verschwinden. Migration-Historie, RLS, Trigger und Edge-Versionen müssen zusammenpassen.

**Letzter Ausweg – kompletter Supabase-Restore:** Nur durch verantwortliche Betreiber unter Berücksichtigung aller KATOOS-Dienste und nach Schadensanalyse. Ein vollständiger Restore versetzt auch fremde Daten zurück und macht die gesamte Projekt-Datenbank währenddessen zeitweise unerreichbar; Daten seit dem Wiederherstellungspunkt können verloren gehen. Ob tägliche Backups/PITR verfügbar sind, ist **nicht geprüft**. Storage-Objekte und Edge-Funktionen werden durch Datenbank-Restore nicht in derselben Weise wiederhergestellt. `Restore to New Project` ist zur Analyse meist die sicherere Wahl, benötigt aber passende Berechtigungen, ggf. Kosten und manuelle Konfiguration.

## 6. Externe Betriebsdokumentation

- [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase Restore to New Project](https://supabase.com/docs/guides/platform/clone-project)
- [Supabase Edge Function Configuration / JWT](https://supabase.com/docs/guides/functions/function-configuration)

**Status:** Der heutige Schritt ist ausschließlich **offline QA und Wiederherstellungsplanung**, keine Live-Freigabe. Nächste unverzichtbare Operatorentscheidung: Backupstatus, RPO/RTO und bei Bedarf Budgetfreigabe für eine isolierte QA-Umgebung.

## Stage 2Y ergänzender Live-Backup-Nachweis (30.10.2026)

Die obige Momentaufnahme aus Stage 2X („Backup-Verfügbarkeit noch nicht bestätigt“) ist durch den späteren **read-only Supabase-CLI-Abgleich** präzisiert: **8 `COMPLETED` physische Backups** im Zeitraum 23.–30.10.2026, letztes Backup 30.10.2026 06:07 UTC. **PITR ist deaktiviert**, WAL-Archivierung ist aktiviert. Eine tatsächliche Recovery-Probe sowie RPO/RTO und Betreiberfreigabe fehlen weiterhin. Der Live-Rollout bleibt daher NO-GO. Siehe `KATOSYNC_MESH_STAGE2Y_BACKUP_READINESS_2026-10-30.md`.
