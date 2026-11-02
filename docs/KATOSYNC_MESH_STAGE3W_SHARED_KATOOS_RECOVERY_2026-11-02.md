# Stage 3W – gemeinsames KATOOS-Backup und vollständige lokale KatoSync-Restoreprobe

**02. November 2026 · NMKato Solutions · Entwicklungszweig (Draft) · KEINE produktiven Änderungen**

## Belegter Live-Stand (ausschließlich lesend)

Das KATOOS-Supabase-Projekt in `eu-central-1` ist `ACTIVE_HEALTHY` und verwendet PostgreSQL 17.6. Seine vorhandene `katosync`-Basis umfasst weiterhin **fünf RLS-geschützte Tabellen**, zwei registrierte Geräte, null vertrauenswürdige Geräte und null Einladungen. Die fünf zusätzlichen Inbox-/Relay-Migrationen aus Stage 3V sind nicht ausgerollt.

Der bestehende read-only CLI-Check `node scripts/qa-mesh-backup-readiness.mjs --live-read-only` hat am **02.11.2026, 12:44:32 UTC** bestätigt:
- **8** mit `COMPLETED` markierte physische Backups;
- letztes physisches Backup vom **02.11.2026 um 06:07:09.633 UTC** (07:07 Uhr MEZ), zum Prüftermin 398 Minuten alt;
- `pitr_enabled=false`, jedoch `walg_enabled=true`.
- `restoreTested=false`, `recoveryReady=false`, `operatorApproval=false`, `authorizedToDeploy=false` – exakt diese Flags bleiben unverändert.

**Wichtig:** `walg_enabled=true` ist kein Nachweis für buchbares/aktiviertes PITR. Abgeschlossene physische Backups belegen weder echte erfolgreiche Cloud-Wiederherstellung noch RPO/RTO. Ein Restore des gemeinsamen KATOOS-Projekts könnte die Daten anderer Produkte und seit dem letzten Backup erfolgte Transaktionen betreffen. Supabase weist zudem darauf hin, dass physische Datenbankbackups nicht die eigentlichen Storage-Objekte einschließen. Quelle: https://supabase.com/docs/guides/platform/backups

## Neu: kompletter PostgreSQL-Restore über acht Tabellen

`KATOSYNC_STAGE3W_RESTORE_ALLOW=SYNTHETIC_UNIX_SOCKET_ONLY bash scripts/qa-mesh-shared-restore-stage3w.sh` erstellt ausschließlich auf dem autorisierten Mac einen Wegwerf-PostgreSQL-17-Cluster unter `/tmp/ksmeshqa.XXXXXX`, mit Modus 0700, ohne TCP-Listener oder externes Netzwerk. Der Runner verweigert fehlende explizite Freigabe oder fremde Parameter und beseitigt Cluster, Backupdatei und Socket per Exit-Trap.

Anschließend wird der **wirkliche SQL-Migrationsweg der Stage3V** inklusive Membership-Baseline, Einladungs-, Proof-, Relay-Tabellen und synthetischen Mehrkonto-Daten ausgeführt. Ein lokales `pg_dump` im Custom-Format wird in eine zweite lokale Datenbank `recovered` via `pg_restore` zurückgespielt. Vorher/nachher wird ein deterministischer Daten-Fingerabdruck **über alle acht Tabellen** verglichen.

Zusätzlich geprüft: acht Tabellen haben RLS aktiviert; `anon` besitzt keinen Schema-Zugriff; angemeldete Nutzer können ihre Membership/Geräte, aber nicht direkt Inbox-/Relay-Nachrichten lesen; Schutztrigger sind wiederhergestellt; fremde synthetische Konten sehen keine Datensätze; keine Netzwerk-/Cron-Erweiterungen. Eine nach dem Restore mutierte Zeile in der Quelldatenbank verändert die wiederhergestellte Kopie nicht.

Erfolgsmarker:
`STAGE3W_EIGHT_TABLE_DATA_FINGERPRINT_MATCH`
`STAGE3W_RESTORED_RLS_AND_ROLE_GATES_PASS`
`STAGE3W_RESTORED_DATA_UNCHANGED_AFTER_SOURCE_MUTATION`
`STAGE3W_FULL_EIGHT_TABLES_DISPOSABLE_RESTORE_PASS`

**Grenze:** Diese Übung stellt nur **synthetische lokale Testdaten** wieder her. Sie ist weder das Backup noch eine Restoreprobe des Live-KATOOS-Systems. Sie autorisiert ausdrücklich keine DDL-/Edge-Änderung, kein Peer-Trust und keine Remote-Jobs.

## Entscheidung zum produktiven Rollout

Die gemeinsamen KATOOS-Ressourcen erlauben zwar eigene KatoSync-Tabellen, aber **keine eigenständige Transaktions- oder Backup-Grenze**. PITR ist derzeit nicht aktiviert. Laut Supabase ist PITR ein kostenpflichtiges Add-on und ein Restore eines alten Datenbankbackups setzt das gesamte Projekt zurück. Wir aktivieren daher keine kostenpflichtigen Optionen ohne Zustimmung und verwenden keinesfalls den Full-Project-Restore als automatisches Rückrollverfahren für eine additive Schemaänderung.

**Stage3W-Nachweis:** 8 physische Backups im Inventar; vollständiger lokaler Acht-Tabellen-Restore erfolgreich; Live-Restore weiterhin **nicht nachgewiesen**. Produktive Migrationen, Inbox-/Relay-Edge-Dienste, installierte Apps und Gerätevertrauen bleiben unverändert.

**Für eine spätere ausdrücklich freigegebene Einspielung:** Frische Backup-/Migrationsinventur, klare Betreiberentscheidung zu tolerierbarem Datenverlust (RPO), Wartungs-/Rollback-Prozedur für die betroffenen *KatoSync*-DDL-Objekte statt Whole-Project-Restore, gegebenenfalls isolierte überprüfte Backup-Restoreprobe und Freigabe der konkreten fünf SQL-Migrationen. Die sichere und kostengünstige nächste Benutzer-Abnahme ist zunächst eine **eigene, signierte KatoSync-Mesh-QA-App** mit dem bereits entwickelten nur lesenden Stage3U-KATOOS-SSO-Preflight, ohne vorhandene Stage2I-Builds zu überschreiben. Danach müssen die noch offenen Chat-/Provider-Blocker geprüft werden.

Quellen: https://supabase.com/docs/guides/platform/backups und https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery
