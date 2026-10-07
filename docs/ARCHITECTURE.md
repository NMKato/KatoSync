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

## Context Fabric Foundation

KatoSync erzeugt lokal zusätzlich einen versionierten Context Pack aus den bereits gescannten
Status-, Roadmap- und Memory-Quellen. Der Rust-Core bleibt dafür die einzige Business-Logik:

- kanonisches JSON: `CURRENT_CONTEXT_PACK__<device>.json`
- abgeleitete Obsidian-Markdown-Ansicht: `CURRENT_CONTEXT_PACK__<device>.md`
- Vertrag und Consumer-/Writeback-Grenzen: [`CONTEXT_PACK.md`](CONTEXT_PACK.md)

Die Dateien werden nicht hochgeladen. Secret-markierte Context-Quellen lassen nur die Pack-Erzeugung
fail-closed abbrechen (kein Pack, alter Pack entfernt, Sync-Warnung); die bestehende Pipeline läuft weiter.
Autonome Memory-Schreibzugriffe sind nicht Teil dieser Foundation.

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
- KatoSync-eigene Secrets liegen ausschließlich im OS-Schlüsselbund (`com.nmkato.katosync`; macOS Keychain, Windows Credential Manager, Linux Keyutils): der optionale lokale Endpoint-Key (`local-provider-api-key`) und je API-Slot ein Key (`api-provider-api-key:<slot-id>`). Jeder Key ist an den Endpoint-Origin gebunden, wird nur an genau diesen Origin gesendet (Klartext-HTTP nur an exaktes Loopback, sonst HTTPS) und beim Trennen gelöscht. Config, REX, Ledger, Logs und Commits enthalten nie Rohkeys.

### Netzwerk- und Cloud-Grenze

- **Custom Endpoints** (`endpoint_guard.rs`, gespiegelt in `providerPolicy.ts`): Local Lane erlaubt
  exaktes Loopback (`localhost`, 127.0.0.0/8, `::1`; HTTP oder HTTPS) oder öffentliches HTTPS. Die
  API Lane erlaubt ausschließlich öffentliches HTTPS. Private/RFC1918/CGNAT/ULA, Link-Local,
  Cloud-Metadaten (u. a. 169.254.169.254, `fd00:ec2::254`, IPv4-mapped/NAT64/6to4-Formen),
  Multicast, Broadcast, unspezifizierte und reservierte Bereiche sowie LAN-Namen (`.local`,
  `.internal`, einzelne Labels …) werden mit `endpoint_blocked` abgelehnt. Eine LAN-Freischaltung
  gibt es im Release nicht; käme sie später, dann nur als getrennte, ausdrückliche Expert-Option.
- **DNS/Rebinding:** Jeder Endpoint-Client nutzt einen eigenen Resolver, der jede Auflösung beim
  Verbindungsaufbau gegen die Zielklasse prüft (gemischte Antworten → komplett gesperrt). Kein
  Proxy (würde die Prüfung umgehen), keine Redirects → Credentials verlassen nie den validierten Origin.
- **URL-Credentials** (`user@`, `user:pw@`), Query und Fragment sind verboten.
- **Lokal-only vs. Upload** (`cloud_boundary.rs`): Scan/Vorschau, Dry-Run, CURRENT-/Snapshot-Dateien,
  Context Pack, Local Brain und Provider-Erkennung bleiben auf dem Rechner. Inhalte verlassen ihn nur
  über den Mistral-Library-Sync, den API-Lane-Worker und die KatoSync-Web-API.
- **Datei-Uploads:** feste Typ-Allowlist (md/markdown/txt/json/csv, pdf/png/jpg/jpeg) und harte
  50-MiB-Grenze. Text wird vor dem Upload vollständig lokal auf Secret-Muster geprüft. PDF/Bilder
  sind nicht prüfbar und gehen nur mit `safety.allowUnscannedBinaryUploads` (Default aus) und
  passender Datei-Signatur raus; die Scan-Vorschau zeigt zurückgehaltene und ungeprüfte Dateien an.
  Es gibt keinen Cloud-DLP-Dienst.

### Routingvertrag

Standard: `Codex → Claude Code → API Lane → Local Brain → Remote Orchestrator + RDC → Local Control`. Nur Auth-, Quota-,
Capacity- und Unavailable-Klassen sind failover-fähig (`nextProviderAfterFailure`). `job_failed`
ist ausdrücklich nicht failover-fähig; ein gewöhnlicher Build-, Test- oder Codefehler bleibt beim
aktuellen Besitzer. Local Control/RDC ist immer der letzte Platz und nimmt Jobs auch ohne
laufenden Daemon in die Queue auf (sie verschwinden nicht); „läuft“ wird aus dem Daemon-Heartbeat
(`state.json`, max. 90 s alt) abgeleitet.

Das Cockpit zeigt Provider-Health, den aktuellen Besitzer und den letzten Statusübergang.
Übergänge sind flüchtige, redigierte ViewModel-Events; Prompt-, Source- oder Token-Inhalte gehören
nicht in dieses Modell.

### API Lane (pay-per-token)

Die API Lane ist eine zusätzliche, getrennt abgerechnete Lane neben Abo-CLIs, Local Brain/REX,
Vision, AutoQ und Local Control; sie wird nie aufgewärmt und ersetzt keine andere Lane.

- **Setup:** Key einfügen → `lib/apiKeyInference.ts` erkennt den Provider rein lokal am Key-Präfix.
  Nur eindeutige Präfixe (`sk-ant-`, `sk-or-`, `sk-proj-`/`sk-svcacct-`, `xai-`) ergeben einen
  Vorschlag; mehrdeutige/unbekannte Formate verlangen eine kurze Nutzerauswahl. Es gibt keinen
  Probe-Request und kein Fan-out an mehrere Provider. Custom OpenAI-compatible bleibt wählbar (nur HTTPS).
- **Verifikation:** Erst nach Bestätigung speichert Rust den Key im Schlüsselbund
  (`save_api_provider_key`, lehnt Keys eines eindeutig anderen Providers mit
  `api_key_provider_mismatch` ab), lädt die Modellliste nur bei diesem Provider
  (`api_provider_models`, begrenzt auf 8 MiB / 2000 IDs, keine Redirects) und testet genau diesen
  Slot (`test_api_connection`). Schlägt die Prüfung fehl, wird der Key wieder entfernt.
- **Modelle/Effort:** Die Live-Liste des Providers ist maßgeblich; der eingebaute, datierte Katalog
  (`API_CATALOG_AS_OF`) annotiert nur Preis, Tempo und Effort und erfindet keine Modell-IDs. Effort
  wird nur angeboten, wo Rust ihn tatsächlich sendet (OpenAI, OpenRouter, xAI).
- **Kosten/Budget:** Planwerte sind immer als Schätzung markiert. Das lokale Ledger trennt
  provider-gemeldete Kosten von Snapshot-Schätzungen. Ein optionales Monatsbudget je Slot sperrt
  den Slot für Auto-Routing und Worker-Läufe, sobald es erreicht ist.
- **Routing:** `resolveApiConnection` (TS) bzw. `select_api_connection` (Rust) wählen genau einen
  Slot. Explizite oder projektbezogene Wahl fällt nie still auf einen anderen bezahlten Provider
  zurück; `fallback`-Slots kommen im Auto-Modus erst ohne Alternative.

### Validierungs-Gates

- **Automatisiert:** `npm test`, `npm run typecheck`, `npm run build`, `cargo fmt --check`, `cargo clippy --all-targets`, `cargo test`.
- **Live (manuell, macOS):** `cargo test --lib live_provider_gate -- --ignored --nocapture` liest echten Auth-Status und fährt den READY-Test (kein Login/Logout).
- **Human-Gate:** echter Browser-Login/Re-Login je Provider sowie visuelle Prüfung in Light/Dark.
- **Windows-Gate:** Erkennung von `.exe`/`.cmd`-Installationen, Login inkl. Abbruch, fehlende Konsolenfenster.

## Agent Sync Cockpit: kanonisches Job-/Lane-Modell

Overview, Jobs & Queue und Live Monitor rendern dieselbe `AgentSyncState`
(`lib/agentJobModel.ts → normalizeAgentSyncState`). Das ViewModel komponiert sie einmal aus allen
Quellen; Views enthalten keine Provider-, RDC- oder Scheduler-Entscheidungen.

**Fünf kanonische Lanes** (Konnektivität getrennt vom aktuellen Job-Besitzer):

1. Codex · 2. Claude Code · 3. Local Brain (vorbereitete Schnittstelle) – Modell-Lanes
4. Remote Orchestrator + RDC – intelligenter Fallback (LLM-geführtes Coden/Review/Orchestrieren),
   nur mit gültiger Lease übernahmefähig
5. Local Control – deterministisches Substrat, nie als LLM ausgewiesen; parkt Jobs sicher

`providerPolicy.nextLaneAfterFailure` setzt diese Kette um; `job_failed` wechselt nie die Lane.

**Normalisierte Quellen:** Action-Plan-Tasks, Runner-Lauf, Local-Control-Lanes/Inbox/Outbox,
Provider-Router-Queue (`control/rdc-fallback/*.json`), Provider-Health-Scheduler
(`control/provider-health.json` + Log: `RESUME` ohne `RESUME_DONE` = laufende Wiederaufnahme),
Continuation-Watchdog (`control/continuation/`) und die Remote-Orchestrator-Lease. Der Rust-Adapter
`orchestration.rs` liest alles begrenzt (64 KiB je Datei, max. 40 Queue-Einträge), redigiert
Home-Pfade und liefert vom Worktree nur den Basename plus zwei Nachweise: `branchMatches`
(aktueller Branch = erwarteter Branch) und `worktreeBusy` (aktiver Local-Control-Writer im selben
Worktree).

Der Continuation-Zustand trennt zwei Wahrheiten: `workerState` kommt unter macOS aus dem
kanonischen LaunchAgent `com.nmkato.katosync.continuation-watchdog`; `status`, Cursor und Ergebnis
kommen aus dem aktuellen/letzten Plan. Ein fehlgeschlagener Plan bedeutet deshalb nicht, dass der
Worker gestoppt ist. Agent Sync zeigt außerdem einen frischen `attached`-Heartbeat ohne Job als
externen Projekt-Supervisor/Standby, nicht als arbeitende KatoSync-Lane.

**Wiederaufnahme nur mit Nachweis:** Ein wartender Router-Job ist erst „sicher fortsetzbar“, wenn
der Branch nachgewiesen ist, kein anderer Writer läuft, der Worktree frei ist, keine
Orchestrator-Lease ihn hält und eine intelligente Lane übernehmen kann. Kein automatischer Merge.

### Remote Orchestrator + RDC: Lease-Vertrag

`control/remote-orchestrator.json` (Schema 1, atomar, Modus 0600), geschrieben ausschließlich über
`scripts/katosync-orchestrator-lease.py` (argv, keine Shell):

```json
{
  "schemaVersion": 1,
  "sessionId": "rdc-session",
  "state": "attached | working | detached",
  "attachedAt": "ISO-8601",
  "heartbeatAt": "ISO-8601",
  "leaseSeconds": 300,
  "transport": { "kind": "rdc", "heartbeatAt": "ISO-8601" },
  "jobId": "router-item-or-task-id",
  "device": "label", "model": "label", "activity": "kurz", "nextStep": "kurz"
}
```

- Lease 30–1800 s; Heartbeats > 120 s in der Zukunft werden verworfen.
- UI: *angebunden/arbeitet* (Heartbeat ≤ 5 min, Lease gültig), *veraltet* (Lease gültig, Heartbeat
  alt – blockiert weiterhin andere Writer), *abgemeldet*, *nicht verfügbar*. RDC-Transport wird
  separat als online/veraltet/unbekannt geführt.
- Ein `working`-Heartbeat allein begründet keinen KatoSync-Jobbesitz. Erst wenn `jobId`,
  `sessionId`, Queue-Status `orchestrator_active`, `leaseOwner` sowie Remote- und Job-Lease
  gleichzeitig übereinstimmen und gültig sind, gilt die Remote-Lane als Besitzer. Unbestätigte
  Claims blockieren fail-closed, erfinden aber keinen laufenden Job.
  Für die Warm-up-Sperre (`work_active`) zählt ein reiner `attached`-Heartbeat ohne Job nicht als
  Arbeit; jeder Claim unter gültiger Lease und jedes noch nicht freigegebene `orchestrator_active`
  bleiben blockierend.
- `claim --item <id>` setzt einen wartenden Router-Job auf `orchestrator_active`; der
  Provider-Health-Scheduler nimmt nur `waiting`/`provider_ready` auf → genau ein Writer nach der
  Übergabe. `claim` verweigert, solange der Scheduler denselben Job bereits wieder aufnimmt.
  `release --status waiting|completed|failed` (bzw. `--if-expired` für abgelaufene Leases) gibt ihn
  frei. Bei fremder Rückforderung einer abgelaufenen Lease wird der alte Remote-Owner auf
  `detached` eingehegt und dessen RDC-Liveness entfernt; es wird kein neuer Heartbeat und keine neue
  Arbeit erfunden. Auch ein explizites `detach` entfernt die RDC-Liveness.

### Provider-Re-Check

- Billige Auth-/Status-Checks (ohne Inferenz) halten Provider-Karten höchstens **10 Minuten** alt.
- Gemeldete Reset-Zeitpunkte („try again at …“, „resets in 2h 30m“, ISO) werden exakt
  angesteuert; relative Hinweise bleiben an der READY-Klassifikation (`checkedAt`) verankert.
- Teure READY-Tests laufen nur, wenn Arbeit wartet: am Reset-Zeitpunkt bzw. ohne Hinweis
  höchstens alle 30 Minuten (`providerRecheckPlan`).
- Ein billiger Check hebt Quota/Kapazität/Offline nie auf und stuft verfügbare Provider nicht herab.

## Auto-Lane Planner (Auto Mode)

Auto Mode macht bereits **ausgewählte + freigegebene** Action-Tasks zu autonomer, sichtbarer Arbeit.
Es gibt keinen zweiten Scheduler: der reine Planer `lib/autoLanePlanner.ts` wird in
`normalizeAgentSyncState` ausgewertet (`AgentSyncState.autoLanes`), der Dispatcher im ViewModel
startet ausschließlich dessen `dispatch` über den bestehenden Runner (`runCodexTask`).
`control/lanes.json` behält seine Bedeutung (aktive Local-Control-Jobs).

- **Auto-Lane = ein Projekt.** Kopf-Task = erster offener ausgewählter `codex_cli`-Task in
  Board-Reihenfolge; Folge-Tasks warten dahinter (`laneId = auto:<projectId>`, `lane_follow_up`).
- **Zustände:** `planned` (Auto Mode aus), `queued` (startet beim nächsten Takt bzw. wartet auf den
  Runner-Slot/das Repo), `running`, `waiting` (Merge, Provider, Tageslimit, Start-Gate),
  `blocked` (Fehler, Unterbrechung, kritisch, Freigabe offen, Repo fehlt/nicht zugeordnet).
- **Gates:** nie automatische Freigabe; kritische Tasks und ungeklärte Freigaben sperren die
  Projektreihenfolge; `executed` wartet auf Merge, `failed` sperrt nur das eigene Projekt.
  Globale Gates: `startSafety`, Remote-Orchestrator-Lease, Tageslimit, Runner-Routing
  (bevorzugter Runner, sonst der andere CLI-Runner nur bei Provider-Nichtverfügbarkeit;
  ein Jobfehler wechselt nie den Runner).
- **Ein Writer pro Repo:** Claims und laufende Lanes belegen ihr Repo; mehrere Slots sind im
  Planer vorbereitet (`maxConcurrent`), aktiv ist heute **1** – der Runner-Zustand ist ein
  Singleton und `startSafety` meldet bei jedem laufenden Runner `runner_busy`.
- **Idempotenz:** Dispatch-Claims (`katosync.autoLane.claims.v1`) werden synchron vor jedem `await`
  persistiert und erst nach dem finalen Task-Status freigegeben. Ein Claim oder `running` ohne
  laufenden Besitzer (Neustart, anderes Gerät) wird `blocked/interrupted_run` und nie still neu
  gestartet; „Freigeben“ stellt den Task bewusst zurück (`deferred`).
- **Takt:** nur bei offener App und eingeschaltetem Modus alle 15 s (frischer Local-Control-Snapshot,
  dann Bewertung); Action-Plans und Merge-Status höchstens alle 5 min; nach Abschluss/Fehler sofort.
- **Persistenz:** Auto Mode, Claims und Board-Auswahl liegen lokal (`lib/autoLaneStore.ts`) und werden
  beim Logout mit den Tenant-Caches gelöscht.
- **Auto-Merge:** bewusst nicht enthalten. `autoLanes.merge = { mode: "manual" }` ist die Naht für
  einen späteren, verifizierten Merge-Mechanismus.

## Local-Brain-Modellpakete

Runtime und Modellgewichte sind getrennt: KatoSync verwaltet die gepinnte llama.cpp-Runtime, die
Gewichte kommen als versioniertes Paket (`kato-model-package/1`) aus einem R2-faehigen
Verteilkanal oder dem gepinnten Upstream. Gewichte werden erst nach exakter Groessen- und
SHA-256-Pruefung atomar installiert; Update, Pin, Rollback und Entfernen laufen ueber ein Ledger
ohne URLs oder Tokens. Ein Lizenz-/Redistribution-Gate verhindert, dass ein Paket ohne Freigabe
oeffentlich wird. Vertrag, R2-Layout und Release-Checkliste: [`MODEL_DISTRIBUTION.md`](MODEL_DISTRIBUTION.md)
