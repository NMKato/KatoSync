# KatoSync 2.0 Beta – sicherer lokaler Chat-Index-Refresh (25.10.2026)

## Fehler / reale Beobachtung
- Unter **Agent Sync → Master-Chat** blieb bei ausgewähltem KatoSync-Projekt der Chat deaktiviert: der native Leseaufruf konnte die Historie nicht laden.
- Read-only-Bestandsaufnahme ergab: gültige SQLite-Memory-Fabric-Datenbank mit **Schema v1**; der aktuelle Chat braucht mindestens v3 für die Historie.
- Zusätzlich stimmt der bisher indexierte Git-Root-Fingerprint nicht mehr mit dem registrierten Root überein. Die normalisierte Repository-Identität ist jedoch unverändert. Die bewusste Root-Sperre darf nicht entfernt werden.
- Es existiert ein bestätigter lokaler Memory-Index; kein Passwort- oder Cloud-Modellproblem nachgewiesen.

## Umsetzung: sichere Reparatur, kein stilles Update
- Neuer rein lesender nativer Diagnosebefehl \`continuity_chat_diagnostics\` liefert nur \`ready\`, \`needs_refresh\`, \`missing_index\`, \`foreign_repository\` oder \`unavailable\` und eine Repair-Gate-Entscheidung – keine Pfade, Tokens, Dateninhalte.
- Chat zeigt nur bei passender Registry-/Repository-Identität einen bewussten Schalter zum **Sicherungs- und Index-Refresh**. Vor Bestätigung keine Dateimutation.
- Native \`continuity_chat_repair_project\` nimmt nur eine registrierte Projekt-ID und ein explizites Zustimmungsflag an; nie einen fremden Root aus der UI.
- Beim Root-Wechsel wird nur **identische normalisierte Repository-Identität** akzeptiert. Andere / nicht beweisbare Repository-Bindungen bleiben blockiert.
- Vor Schema-Migration/Reindex erstellt SQLite \`VACUUM INTO\` eine **konsistente WAL-einschließende Datenbankkopie** im privaten Backup-Ordner; Backup-Integritätsprüfung \`PRAGMA quick_check\` muss \`ok\` sein. Unix-Verzeichnisrechte 0700, Backupdatei 0600.
- Erst danach öffnet der vorhandene MemoryStore den Store in Schreibmodus (atomare v1→v4-Migration) und indexiert ausschließlich zugelassene Dokumentquellen des tatsächlich registrierten Git-Projekts. Der alte Stand bleibt in der Sicherung.
- Erfolgreiche Reparatur lädt die lokale Chat-Historie neu; Chat wird erst bei erfolgreichem History-Read aktiv. Es gibt **keine automatische Frage, keinen Codex-/Claude-Start und keinen Cloud-Fallback**.

## Tests / Gates
- SQLite-Vakuum-Sicherungsverfahren auf einer **temporären Kopie** aus v1 geprüft, mit erfolgreicher Integritätsprüfung; produktive DB blieb unverändert.
- 198/198 Frontend-Tests, inkl. 4 neuen Reparatur-Contracts, TypeScript/Vite und 165 Rust Library-Tests bestanden (7 ignoriert). Bestehende Rust-Migrationstests für v1/ältere Versionen grün.
- Es fehlt die echte native Benutzerfreigabe im aktualisierten QA-App-Build; danach SQLite-Stand, Sicherung, Historie, eine explizite lokale Chatfrage und der Git-Zustand unabhängig verifizieren.
- QA-Fix als Draft, keine automatische Main-Merge-/Produktionsfreigabe.

## Privatsphäre
Öffentlich dokumentiert werden nur Design, Risiken, QA-Ergebnisse und Projektkennungen. **Keine internen absoluten Pfade, Personendaten, Secrets, Projektdokumente oder Datenbank-Dumps veröffentlichen.**

Tracking: Issue #130, KatoSync 2.0 Beta.
