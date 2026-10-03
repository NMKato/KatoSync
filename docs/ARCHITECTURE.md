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

## Agent Sync Provider Manager

Der Provider Manager folgt derselben MVVM+R-Trennung:

- **View:** `components/ProviderManager.tsx` rendert Statuskarten, lokale Endpoint-Felder und Priorität, ohne Prozesse oder Credentials zu kennen.
- **Policy:** `lib/providerPolicy.ts` enthält reine, getestete Regeln (Kartenzustand, Failover-Klassen, nächster Provider, Re-Check-Intervall, Endpoint-Validierung, Diagnose-Redaction).
- **ViewModel:** hält Provider-Snapshots, Übergänge und einen Busy-Zustand **pro Karte** (ein offener Browser-Login blockiert nicht die App). Es speichert nur die Provider-Felder auf die Platten-Config; andere ungespeicherte Formularänderungen bleiben unberührt.
- **Repository:** kapselt die strukturierten Tauri-Commands und liefert für die Browser-Demo klar erkennbare Demo-Zustände.
- **Rust-Service:** `src-tauri/src/provider_manager.rs` kapselt alle provider-spezifischen CLI-Details, validiert Executables/Endpoints, setzt harte Timeouts und redigiert Diagnosen.

Tauri-Commands: `provider_statuses`, `test_provider`, `connect_provider`, `cancel_provider_login`,
`disconnect_provider`, `save_local_provider_key`, `discover_local_providers`; Event `provider-login-url`.

Normalisierte Providerzustände sind `installed`, `authenticated`, `available`, `quota_limited`,
`auth_unavailable`, `capacity_unavailable`, `job_failed`, `offline` und `unknown`; dazu liefert der
Service einen `reason`-Code, den das Frontend übersetzt (Rust liefert keine UI-Texte).

### Authentifizierung und Secrets

- Codex: `codex login` → `codex login status` → `codex exec --ephemeral --sandbox read-only --json` (READY nur bei einer Agent-Nachricht exakt `READY`).
- Claude Code: `claude auth login` → `claude auth status --json` (`loggedIn`) → `claude -p --output-format json --permission-mode plan --tools "" --strict-mcp-config --no-session-persistence` (READY nur bei `is_error=false` und Ergebnis exakt `READY`).
- READY-Tests laufen im System-Temp-Verzeichnis, damit keine Projektdateien oder Projekt-Instruktionen geladen werden.
- Login-Prozesse bekommen ein offenes, nie beschriebenes stdin; KatoSync liest nur stdout/stderr, um eine offizielle HTTPS-Login-URL (Host-Allowlist) als Fallback-Link zu melden. Diese URL wird nie geloggt.
- KatoSync besitzt die CLI-Credentials nicht und ruft beim Trennen keinen CLI-Logout auf.
- Einziges KatoSync-eigenes Secret: optionaler Endpoint-API-Key im macOS-Schlüsselbund (`com.nmkato.katosync` / `local-provider-api-key`), gespeichert mit dem Endpoint-Origin. Er wird nur an genau diesen Origin gesendet, an entfernte Hosts nur über HTTPS, und beim Trennen gelöscht. Unter Windows/Linux ist dieser Pfad ein bewusster Safe Seam (kein OS-Store aktiviert → kein Speichern).

### Routingvertrag

Standard: `Codex → Claude Code → Local Model → Local Control/RDC`. Nur Auth-, Quota-,
Capacity- und Unavailable-Klassen sind failover-fähig (`nextProviderAfterFailure`). `job_failed`
ist ausdrücklich nicht failover-fähig; ein gewöhnlicher Build-, Test- oder Codefehler bleibt beim
aktuellen Besitzer. Local Control/RDC ist immer der letzte Platz und nimmt Jobs auch ohne
laufenden Daemon in die Queue auf (sie verschwinden nicht); „läuft“ wird aus dem Daemon-Heartbeat
(`state.json`, max. 90 s alt) abgeleitet.

Das Cockpit zeigt Provider-Health, den aktuellen Besitzer und den letzten Statusübergang.
Übergänge sind flüchtige, redigierte ViewModel-Events; Prompt-, Source- oder Token-Inhalte gehören
nicht in dieses Modell.

### Validierungs-Gates

- **Automatisiert:** `npm test`, `npm run typecheck`, `npm run build`, `cargo fmt --check`, `cargo clippy --all-targets`, `cargo test`.
- **Live (manuell, macOS):** `cargo test --lib live_provider_gate -- --ignored --nocapture` liest echten Auth-Status und fährt den READY-Test (kein Login/Logout).
- **Human-Gate:** echter Browser-Login/Re-Login je Provider sowie visuelle Prüfung in Light/Dark.
- **Windows-Gate:** Erkennung von `.exe`/`.cmd`-Installationen, Login inkl. Abbruch, fehlende Konsolenfenster.
