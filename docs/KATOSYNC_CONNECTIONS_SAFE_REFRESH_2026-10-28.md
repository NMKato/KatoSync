# KatoSync Verbindungen — manueller Status-Refresh (28.10.2026)

Die Seite Verbindungen bietet nun einen zentralen Refresh sowie jeweils einen Status-Refresh in den GitHub- und Mesh-Cards.

## Sicherheit
- Zentraler Refresh prüft KI-Provider sowie den GitHub- und Mesh-Status separat.
- GitHub verwendet nur github_app_connection_status. Nach Fehlern wird ein veralteter Connected-Status entfernt, ohne einen neuen OAuth-Login, Disconnect oder Keychain-Reset auszuführen.
- Die Mesh-Statusprüfung liest nur mesh_local_readiness und die lokale Hub-Präferenz. Alte Scan-Ergebnisse werden verworfen. Sie registriert keine Geräte, erstellt keine Einladung und startet kein Pairing.
- Geräte finden bleibt eine separate, ausdrücklich angeklickte Aktion. Die Server-Registry und Realtime-Verbindung fehlen weiterhin.
- Lokalisierung DE/EN/ES/RU, responsive Glassmorphism-Controls.

## Bestehender Fehler
Auf M3 wurde ein GitHub-Status-Refresh in der laufenden QA-App ausgeführt. Der Status lautet weiterhin Anmeldestatus derzeit nicht verfügbar. Eine gültige Anmeldung wird NICHT durch einen bloßen Refresh vorgetäuscht. Ursache in KATOOS-Session/Keychain/GitHub-Rotation noch offen, keine Credentials gelesen.

## Freigabestatus
Nur Entwicklungszweig auf Draft-PR #162; produktive KATOOS-Datenbank, normale und laufende QA-Apps unverändert. Keine echte Mesh-Kopplung oder Fernauftragsfreigabe.
