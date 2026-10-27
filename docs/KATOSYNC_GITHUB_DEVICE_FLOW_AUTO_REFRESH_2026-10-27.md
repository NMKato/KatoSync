# KatoSync GitHub App – automatische OAuth-Fertigstellung und Tokenverlängerung

Stand 27.10.2026, gestapelt auf Status-Retry PR #146.

## Read-only Diagnose
- GitHub-Browser auf M2 zeigte Device Activation success. Das bestätigt die Freigabe, nicht die spätere Tokenübernahme im KatoSync-Prozess.
- M2 hat alte KatoSync-Test-App neben Mesh QA; Keychain-Bereiche unterscheiden sich. Keine Tokenmigration aus CLI/anderen Apps.
- UI hatte bisher nur manuellen Button zum Poll nach Browserfreigabe. GitHub-App-Zugriffstoken laufen laut GitHub-Dokumentation nach acht Stunden ab, in dieser Codebasis wurden gespeicherte Refresh-Tokens noch nicht verwendet. Dies erklärt eine mögliche gestern-heute-Störung, ist für den konkreten Screenshot jedoch nicht abschließend bewiesen.

## Fix
- Nach bewusstem Klick auf Verbinden pollt die isolierte KatoSync-GUI automatisch unter Einhaltung der von GitHub gemeldeten Warteintervalle. Poll stoppt bei Ablauf/Abbruch/Komponentenwechsel. Nach dem nativen sicheren Token-Speichern muss zusätzlich GitHub-Status bestätigt werden. Kein voreiliges Connected.
- Rust erneuert ablaufende GitHub-App-Device-Flow-Tokens mit deren Refresh-Token direkt beim GitHub-Endpoint. Device Flow erfordert laut GitHub hierfür keinen eingebetteten Client Secret. Neue Access/Refresh-Tokenpaare werden in OS-Keychain atomar pro laufendem Prozess serialisiert und vor Overwrite an aktuelle KATOOS-UID sowie unveränderte GitHub-Nutzeridentität gebunden.
- Benutzermetadaten werden neu geprüft, Keychain wird vor Speicherung auf paralleles Logout/Token-Replacement kontrolliert. Kein Token im UI, Chat, Dateien oder Logs, keine Credential-Reuse aus GitHub CLI, keine neuen Schreibberechtigungen. Falsche/abgelaufene Autorisierung bleibt fail-closed und erfordert erneuten ausdrücklichen Device Flow.
- Authentisierter GitHub-Status und nur lesendes Repo-/Issue-Inventar benutzen denselben Refresh-Pfad. Bestehende M3-Integration wird nicht verändert.

## Gates
- TypeScript, Frontend, Rust mit QA-Feature und ohne Feature, nativer macOS Test-Build, SHA256/codesign.
- Nur isolierte M2 QA App aktualisieren mit Rollback. Browser-Login auf GitHub ist nicht gleich automatischer App-Speichererfolg.
- M2 Benutzer führt die Anmeldung explizit IN KatoSync Mesh QA aus und sieht nach GitHub-Freigabe den Connected-Status ohne extra Klick.
- Stabile Signierung/Keychain-ACL, KatoSync Legacy-Konten, echte mTLS-M2-M3-Verbindung und Writer-Gates bleiben separat.
- GitHub-Quelle: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
