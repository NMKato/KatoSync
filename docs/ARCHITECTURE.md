# KatoSync Architektur

KatoSync folgt der MVVM+R-Strategie:

- **Model:** gemeinsame Datentypen für Config, Scan, Sync, Upload und lokalen Uploadplan.
- **View:** React-Komponenten ohne Datei-, API- oder Keychain-Logik.
- **ViewModel:** UI-State, Validierung und Nutzeraktionen.
- **Repository:** Zugriff auf Tauri Commands, Mistral API, Keychain, LaunchAgent und später Reports.

## Version 1.0

Version 1.0 bleibt bewusst fokussiert:

- Projektordner scannen
- sensible Dateien ausschliessen
- CURRENT-Dateien erzeugen
- Mistral Library Upload ausführen
- macOS Keychain verwenden
- lokalen LaunchAgent für automatische Uploads installieren
- Logs anzeigen

Die Business-Logik für Scan, Secret-Filter, Bündelung und Upload liegt im Rust-Core.
Das Frontend ruft diese Funktionen nur über ein Repository auf.

## Reports Inbox für Version 1.1

Die beste Erweiterung für fertige Agentenberichte ist eine **Mistral Workflow Runs API-Abfrage**.
Das ist besser als Gmail/Outlook als erster Schritt, weil:

- dieselbe Mistral API-Key-Authentifizierung genutzt werden kann
- keine zusätzlichen Mail-OAuth-Flows nötig sind
- Ergebnisse schneller und strukturierter verfügbar sind
- Reports als echte App-Daten gespeichert und durchsucht werden können

Geplante Module:

- `Report`: Model für Titel, Run-ID, Status, Ergebnis, Zeitstempel und Quelle
- `ReportsRepository`: ruft Workflow Runs und einzelne Run-Details ab
- `ReportsViewModel`: synchronisiert neue Reports, markiert gelesen/ungelesen
- `ReportsView`: Liste, Detailansicht, Suche und lokales Archiv

Technische Richtung:

- Workflow Run Liste: `GET /v1/workflows/runs`
- Einzelner Run: `GET /v1/workflows/runs/{run_id}`
- Ergebnisfeld auswerten, wenn `status` abgeschlossen ist
- lokale Ablage unter `~/Library/Application Support/KatoSync/reports/`

E-Mail-Import bleibt eine spätere Option, falls Mistral Workflows Reports nur per Mail oder Chat liefern.
Dann sollten Gmail/Outlook als eigene Repositories mit OAuth und klar getrennten Berechtigungen gebaut werden.

## Mistral Work Scheduler

Der lokale Uploadplan (LaunchAgent, steuert den Datei-Upload) ist nicht dasselbe wie der
serverseitige Mistral Work Scheduler (steuert, wann die Agenten laufen).
