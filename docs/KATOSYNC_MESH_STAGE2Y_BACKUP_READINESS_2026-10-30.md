# KatoSync Stage 2Y – Live-Backup-Inventar und strikt nicht-freigebender Wiederherstellungs-Check

**30. Oktober 2026** · Folgestufe zu Stage 2X / [Draft-PR #190](https://github.com/NMKato/KatoSync/pull/190). Keine SQL-Migration, keine Edge-Funktion, kein Restore, kein kostenpflichtiger QA-Branch, keine Keychain-/App-Änderung.

## Verifiziertes Live-Ergebnis (Supabase Management API über bestehende Supabase-CLI-Anmeldung)

Projekt: `xbnnlyyxiilklsygxcof` („KatoOS (old Cirqa)“), Region `eu-central-1`. Mit dem **ausschließlich lesenden** Befehl

```bash
supabase backups list --project-ref xbnnlyyxiilklsygxcof --output-format json
```

wurden am 30.10.2026 **acht** mit `COMPLETED` markierte physische Sicherungen vom **23. bis 30. Oktober 2026** nachgewiesen. Die jüngste ist vom **30.10.2026 um 06:07:00.187 UTC**; die älteste gelistete vom **23.10.2026 um 06:10:42.185 UTC**.

Die API gibt außerdem `walg_enabled: true`, aber **`pitr_enabled: false`** zurück. WAL-Archivierung bedeutet **nicht** automatisch freigeschaltetes Point-in-Time-Recovery. Bei PITR aus ist der letzte tägliche physische Backupstand nicht gleichbedeutend mit einem Wiederherstellungspunkt für den Augenblick unmittelbar vor der Migration.

**Bewertung:**
- **Belegt:** abgeschlossene physische Backups sind gelistet; Region und aktueller Backupzeitpunkt passen zu unserem KATOOS-Projekt.
- **Nicht belegt:** tatsächliche Wiederherstellbarkeit bis zur Anwendung, Restore-Dauer (RTO), zulässiger Datenverlust (RPO), vollständige KATOOS-Kompatibilität nach Restore, aktiver PITR-Schutz. Eine reine `COMPLETED`-Markierung ist **kein erfolgreicher Restore-Test**.
- **Entscheidung:** `NO-GO` für produktive Mesh-Inbox-Migrationen bis Operatorfreigabe und abgeschlossener Recovery-/isolierter QA-Prüfung. Ein kompletter Restore der gemeinsam genutzten Datenbank könnte jüngere KATOOS-Daten verlieren und andere Services beeinträchtigen.

## Wiederholbarer Code-Check

```bash
node scripts/qa-mesh-backup-readiness.mjs --live-read-only
```

Dies ist eine **einzige explizite read-only Management-API-Abfrage** über den bereits authentifizierten Supabase-CLI-Client. Der Helfer startet ausschließlich `supabase backups list --project-ref xbnnlyyxiilklsygxcof --output-format json`, ohne Shell, ohne Download, ohne SQL, ohne Projekt-/Branch-Anlage und ohne Restore. Der Helfer verlangt das explizite `--live-read-only`-Argument und verweigert ansonsten jeden CLI-Zugriff.

Die verifizierte JSON-Antwort enthält nur aggregierte Backupzahlen, Region, Zeitpunkt, Status und Plattform-Flags, **keine** Backup-IDs oder geheimen Schlüssel. Eine fehlende, fehlerhafte oder mehr als **36 Stunden alte** letzte physische Sicherung, ein falsches Projekt-/Region-Resultat, doppelte IDs, ungültige Zukunftszeitpunkte oder fehlerhafte API-Antwort führen zu einem **harten Fehler**.

Für die **tatsächliche Live-Ausführung** war das Ergebnis:

```text
result: COMPLETED_BACKUP_INVENTORY_RESTORE_UNTESTED
completedPhysicalBackups: 8
latestCompletedPhysicalBackup: 2026-10-30T06:07:00.187Z
pointInTimeRecoveryEnabled: false
walArchivingEnabled: true
restoreTested: false
recoveryReady: false
approvedRpoMinutes: null
approvedRtoMinutes: null
operatorApproval: false
authorizedToDeploy: false
trustEnabled: false
remoteJobsEnabled: false
```

Sechs neue reguläre Node-Tests prüfen die reine Auswertung, falsche Region, fehlende/fehlerhafte/veraltete Sicherungen, Zukunftszeitpunkte, PITR-/WAL-Unterscheidung, den **exakt eingeschränkten** CLI-Aufruf und den Default-Deny ohne Freigabeparameter. Die CI-Tests fragen **nicht** nach einem Cloud-Token und sprechen nicht mit Supabase.

## Nächstes unabhängiges Betriebs-Gate

1. **Option A (bevorzugt):** Isolierte, kostenbewusst geprüfte QA-Umgebung mit Replay der vier SHA256-gepinnten Migrationen und zwei zunächst deaktivierten Edge-Diensten; es gibt aktuell noch keinen solchen Branch. Supabase-Branches oder Projektklone können zusätzliche Gebühren auslösen und erfordern **vorher** Preisprüfung und gesonderte Zustimmung.
2. **Option B (Live-Deployment):** Betreiber weist tatsächlich nutzbaren Backup/Restorepfad und RPO/RTO nach und genehmigt ausdrücklich die Auswirkungen auf die gemeinsame KATOOS-Datenbank. Kompletter Restore ist niemals der automatische Rollback für kleine Add-on-Migrationen.
3. Bis dahin bleiben alle 4 Inbox-SQL-Migrationen und beide neuen Edge-Dienste **nicht live**; der Release-Lock bleibt geschlossen und echte M2↔M3-Gerätefreigabe/Remote-Befehle gesperrt.

Referenzen: [Supabase Backup-Dokumentation](https://supabase.com/docs/guides/platform/backups), [Management API: List Backups](https://supabase.com/docs/reference/api/v1-list-all-backups), [Restore to New Project](https://supabase.com/docs/guides/platform/clone-project).
