# KatoSync Project Statusflow

## 2026-06-28 - UX-Redesign Welle 1+2: Foundation, Onboarding, Settings (DONE)

Projekt: KatoSync Desktop App
Status: DONE — großer UX/UI-Umbau (Agenten-Design-Exploration „Lotse"-Richtung umgesetzt)

Foundation:
- CSS-Design-Token-Schicht (`:root` dark + `[data-theme=light]`): Marke (Orange) behalten, Light-Mode lesbar gemacht; Reduced-Motion entschärft (nur dekorative Loops aus, sanfte Übergänge bleiben).

Onboarding (neu, Pflicht, geführt):
- Phasen: Splash (animiertes Logo bei jedem Start) → E-Mail Login/Registrierung (Vollbild-`LoginGate`, nutzt bestehendes Supabase-Login) → Nutzungsbedingungen → Spotlight-Pflicht-Tour 1→5 → App.
- 5 Schritte auf echte Felder (Spotlight-Coachmarks): 1 API-Key, 2 Library-ID, 3 MCP-Token (generieren→kopieren→in Mistral), 4 Quellordner, 5 Uploadplan. Anker `section-api-key`/`-api-library`/`-mcp-token` ergänzt.
- Strikt sequenziell (+1), Auto-Advance bei erfülltem Schritt mit „Bereits eingerichtet ✓" + Fortschrittsbalken (~2,6 s, ruhig). Karte erscheint erst positioniert (kein Sprung), gleitet, „Später"/„Fertig" snoozen für die Sitzung.
- Setup-% = 5 PERSISTENTE Gates (Key/Library/Token/Ordner/Zeitplan+Agent) — NICHT mehr die flüchtigen Live-Test-Flags (sonst fiel das Setup pro Start zurück). Eine Quelle (`vm.setupGates`) für Balken/Checkliste/Tour.

Settings-Konsolidierung:
- Projektordner + Lokaler Uploadplan (Uhrzeit/Wochentage/LaunchAgent) aus dem Dashboard in die Einstellungen verschoben (`toVisibleStep`). Dashboard = nur noch Live/Status.
- Settings-Layout schlüssig: Mistral-Zugang volle Breite (2-spaltiges Formular), API-Kontingent/Ordner/Sync-Regeln/Uploadplan paarweise (je 6 Spalten), Codex Bridge volle Breite, `align-items:start` (keine gestreckten Leerflächen).

Validierung: `tsc` + `npm run build` + `npm run tauri build` grün; iterativ visuell mit Nutzer getestet (Onboarding-Flow, Tempo, Layout, Light-Mode).

Noch offen (nächste Wellen): Token-Maskierung + Präsentationsmodus; Briefings Rich-Komponenten + Persona/Skill-Format-Contract; Dashboard-Cockpit (Diagramme/Verlauf); i18n De/En/Es/Ru. Plan/Blaupause: `/Users/nmk/.claude/plans/katosync-ux-blueprint.md`.

## 2026-06-28 - Echter Abschluss / Merge-Rückkanal (DONE)

Projekt: KatoSync Desktop App + KatoOS MCP Server
Status: DONE — Aufgaben gelten erst nach Merge/Verifikation als erledigt (live verifiziert)

Problem: Ein Task wurde nach dem Codex-Lauf sofort `completed` und verschwand vom Board, obwohl nur ein Branch/PR vorlag. „Fertig" wurde zu früh gesetzt.

Lösung — zwei getrennte Endzustände + Rückkanal:

- Neuer Task-Status `executed` (Ausgeführt: Lauf fertig, PR/Branch liegt vor) zwischen `running` und `completed`. `completed` = erledigt (gemerged/verifiziert), `rejected` = verworfen. `executed`-Tasks bleiben am Board sichtbar mit PR-Link.
- Server (Migration `0007`): Status-CHECK um `executed`, Spalten `pr_url`/`branch`; Endpunkt nimmt optional `prUrl`/`branch`. Worker `70f85fe7`.
- App Rust: Codex-Lauf-Erfolg setzt Task `executed` (statt completed) inkl. pr_url/branch. Neuer Command `check_codex_task` (gh pr view state + lokaler `git branch --merged`).
- App: Lauf-Erfolg → `executed`; `handleCheckCompletions` (Button „Merge-Status prüfen" + automatisch beim Board-Öffnen) setzt gemergte PRs auf `completed`, geschlossene auf `rejected`; manueller „Erledigt"/„Verworfen"-Button (auch für Aufgaben ohne Repo). Queue überspringt `executed`. Board zeigt ausgeführte Tasks mit PR-Link + Status-prüfen/Erledigt/Verworfen.

Entscheidungen (Nutzer): gh-Polling + Button (kein Webhook), on-demand (Board öffnen + Button), Signale: PR gemerged→erledigt, PR geschlossen→verworfen, lokaler Merge→erledigt, manueller Button.

Validierung: cargo check + tsc + vite + tauri build grün; adversarialer Review (keine Blocker); Server 31 vitest grün; Live-E2E (executed mit prUrl/branch persistiert, completed, Negativ-URL 400). App installiert.

## 2026-06-28 - Offene Wellen abgeschlossen: Repo-pro-Projekt + Live-Feed (DONE)

Projekt: KatoSync Desktop App
Status: DONE — die zwei letzten offenen Wellen sind umgesetzt, gebaut, installiert

1) Repo-pro-Projekt-Auto-Detect:

- AppConfig hat neu `projectRepos` (projectId → lokaler Repo-Ordner), persistiert (Rust HashMap `#[serde(default)]` + TS + defaults + normalizeConfig).
- Neuer Tauri-Command `dir_exists`. ViewModel `resolveRepoForProject(projectId)`: nutzt den gemerkten Ordner (prüft Existenz), fragt nur beim ersten Mal / wenn verschwunden per Datei-Dialog und merkt ihn dann (saveConfig).
- Eingesetzt in Board-Queue (pro Projekt-Spalte), Einzel-„An Codex übergeben" (task.projectId) und Briefing („katosync"). Kein Ordner-Dialog mehr pro Lauf.
- Einstellungen (Codex-Bridge-Karte): Liste „Gemerkte Projekt-Ordner" mit „Ordner vergessen".

2) Live-Aktivitäts-Feed der Codex-Läufe (statt indeterminiertem Balken):

- Rust: `run_codex_task` bekommt `AppHandle`; codex-stdout wird als Pipe gelesen (tokio-Reader), jede JSONL-Zeile geht weiterhin in `execution_log.jsonl` UND wird als Tauri-Event `codex-event` (`{taskId,seq,label,text}`) gestreamt. `summarize_codex_event` fasst Events defensiv zusammen. Timeout/Kill bleibt; der Reader wird nach Kill mit eigenem 5s-Timeout + `abort` abgesichert (kein Hängen, falls ein Subprozess das Pipe offen hält).
- Frontend: `listenCodexEvents` (Event-Abo), ViewModel `codexEvents` (letzte 300, Reset pro Lauf), Live-Liste im Codex-Bridge-Panel.

Validierung: `cargo check` grün (nur vorbestehende Dead-Code-Warnung), `tsc` + `npm run build` grün, adversarialer Diff-Review (1 MAJOR gefunden + behoben: Reader-await mit Timeout/abort), `npm run tauri build` grün + installiert.

Damit sind ALLE in der Welle „Codex-Politur"/„nächste Phase" genannten Punkte erledigt (branch-from-main, return-to-main, Prefix-Fix, Auto-Push, PR, Repo-pro-Projekt, Live-Feed). Optionale Zukunft: PR-Auto-Merge-bei-grün, KAI-Runner.

## 2026-06-28 - Codex-Bridge v2: Auto-Push + PR + branch-from-main (DONE)

Projekt: KatoSync Desktop App
Status: DONE — Codex-Läufe landen jetzt auf GitHub (Branch + PR), Arbeitskopie bleibt auf main

Problem (Denkfehler): Die Codex-Bridge committete nur lokal und pushte NIE → nichts auf GitHub; außerdem wurde der Branch vom aktuellen HEAD abgezweigt (Codex-auf-Codex-Stapeln, doppeltes `katosync/katosync/`-Prefix) und die Arbeitskopie blieb nach dem Lauf auf dem Codex-Branch hängen.

Fix (`src-tauri/src/lib.rs`, `run_codex_task`):

- **Von main/Default abzweigen**: `detect_default_branch` (main→master→aktuell, offline), best-effort `git fetch`, `git checkout <default>` vor `checkout -b`. Danach immer **zurück auf den Default-Branch** (Arbeitskopie sauber; Codex-Änderungen leben auf dem Branch). Fehlgeschlagener Lauf ohne Commit → leerer Branch wird gelöscht.
- **Prefix-Fix**: generisches Projekt-Segment (`katosync`/leer) wird weggelassen → kein doppeltes `katosync/katosync/`.
- **Auto-Push** (nur bei Erfolg): `git push -u origin <branch>` über die macOS-Keychain (`credential.helper=osxkeychain` → funktioniert auch aus dem GUI-Prozess ohne `gh` im PATH). Steuerbar per Config `codexAutoPush` (Default an).
- **PR** (Default an, `codexCreatePr`): `gh pr create --base <default> --head <branch>` über absoluten `gh`-Pfad (`/opt/homebrew/bin/gh`); PR-URL wird zurückgegeben. Fallback ohne erzeugten PR: GitHub „Compare & pull request"-Link aus der Remote-URL.
- **CodexRunResult** um `pushed`/`branchUrl`/`prUrl` erweitert; `execution_results`-Artefakte enthalten sie ebenfalls. Codex-Bridge-Panel zeigt Push-Status + klickbaren PR-/Branch-Link; zwei Toggles in den Einstellungen.

Sofort-Aufräumen (manuell): vorhandener Codex-Branch `katosync/katosync/2026-06-28/…` (Commit `d1ff3d3`) nach GitHub gepusht; App-Repo zurück auf `main`.

Validierung: `cargo check` grün, `tsc` + `npm run build` grün, `npm run tauri build` grün + installiert.

Voraussetzungen verifiziert: beide Repos haben `origin` (GitHub), `gh` als NMKato eingeloggt (`repo`+`workflow`-Scopes), `credential.helper=osxkeychain`.

Noch offen (nicht in v2): Repo-pro-Projekt-Auto-Detect (aktuell wählst du pro Projekt-Spalte den Ordner), Live-Aktivitäts-Feed.

## 2026-06-28 - Projekt-Board Welle 1 (DONE)

Projekt: KatoSync Desktop App + KatoOS MCP Server
Status: DONE — Projekt-Board live (Server verifiziert, App gebaut + installiert)

Ergebnis:

- Neue Seite „Projekt-Board" (`projectBoard`); die Action Queue bleibt unverändert das plan-zentrierte Freigabe-Tor (+ Dashboard-Widget + Onboarding).
- Board gruppiert TASKS nach Projekt (Multi-Projekt-Plan möglich). Pro Task: Titel + Pills (Priorität/Risiko/Runner/Status). Triage: auswählen, Reihenfolge (Hoch/Runter), aufschieben (`deferred`), ablehnen, „Wieder einplanen"; „An Codex übergeben" nur bei `approved` + `codex_cli` + nicht `critical`.
- Sequentielle Client-Queue PRO PROJEKT-SPALTE: ein Repo-Ordner je Lauf, ein Task nach dem anderen; Tageslimit client-seitig (lokaler Zähler, Datums-Key → Auto-Reset, überlebt Neustart); Fehlerpolitik = weiterlaufen (Task → `failed`, nächster Task); Stoppen nach laufender Aufgabe.
- Task-Status serverseitig persistent über `PATCH /api/action-tasks/:id/status` (Tauri-Command `update_remote_action_task_status` + Browser-Fallback). Codex-Lauf meldet zusätzlich `running`/`completed`/`failed` auf Task-Ebene (best effort).
- Remote-Mapping liest echte Task-Spalten (`project_external_id`/`risk_level`/`target_runner`/`status`); „Ohne Projekt"-Sentinel statt Fehlbeschriftung; Lade-Query auf `status=pending_review,approved`. localStorage-Key-Bump `katosync.actionPlans.v2`.
- Verträge: `target_runner` = volle App-`ActionRunner`-Union (nur `codex_cli` lokal ausführbar); Task-`risk_level` = `low/medium/high/critical` (`critical` → kein Codex-Lauf, Preflight-Abbruch).

Validierung:

- App: `tsc` + `npm run build` (Vite) grün; `cargo check` grün; `npm run tauri build` grün (`KatoSync.app` gebaut, nach `/Applications` installiert, v1.0.1).
- Server: 29 vitest grün, `0006` live (`supabase db push`), Worker deployed (`789f405e-…`). Live-E2E (Smoke-Tenant): Multi-Projekt-Insert, neue Felder im GET, `PATCH …{deferred}` persistent, Negativpfade 401/400/Tenant-Guard.

Sicherheit:

- Freigabe-Tor bleibt am Plan (Board führt nur Tasks `approved`er Pläne aus). Kein Auto-Merge/main; `critical` nur manuell; kein Secret im Client.

Plan-Datei: `/Users/nmk/.claude/plans/splendid-popping-hinton.md`.

Nächste Wellen (offen): Live-Aktivitäts-Feed (JSONL via Tauri-Events), Codex-Politur (branch-from-main, doppeltes `katosync/katosync/`-Prefix, Repo-pro-Projekt, optional Auto-Push/PR).

## 2026-06-25 - KatoSync 2.0 Blueprint aufgenommen

Projekt: KatoSync Desktop App
Status: Planung fuer KatoSync 2.0 gestartet  

Ergebnis:

- KatoSync 1.x ist als lokaler Mistral Library Uploader funktionsfaehig.
- KatoSync MCP Server ist live unter `https://mcp.katoos.de/mcp`.
- Mistral Custom MCP Connector wurde verbunden und zeigt die Tools:
  - `create_pending_action_plan`
  - `get_action_plan_status`
  - `get_latest_sync_status`
- Neuer KatoSync 2.0 Blueprint wurde gelesen.
- Zielbild: KatoSync wird zum lokalen Agent Action Hub mit Human-in-the-Loop.

Naechster Schritt:

- Phase 1 in der Desktop-App starten:
  - Action-Plan-Datenmodell
  - Action-Queue-UI
  - Mock-Daten fuer lokale Darstellung
  - danach Backend-Anbindung an KatoSync MCP/Supabase

Sicherheitsentscheidung:

- Keine automatische lokale Ausfuehrung ohne Nutzerfreigabe.
- Kein Service-Role-Key in der Desktop-App.
- Keine automatischen Merges, E-Mails, Zahlungen oder finalen Behoerden-/Finanz-/Rechtsabgaben.

## 2026-06-25 - KatoSync 2.0 Phase 1 begonnen

Projekt: KatoSync Desktop App
Status: Action Queue MVP-Schnitt in Arbeit  

Ergebnis:

- Action-Plan- und Action-Task-Typen wurden in der Frontend-Schicht vorbereitet.
- Repository-Mock fuer Pending Action Plans wurde angelegt.
- ViewModel verwaltet Action Plans mit sicheren Statusaktionen:
  - pruefen
  - ablehnen
  - zur spaeteren Ausfuehrung markieren
- Dashboard bekommt eine Action-Queue-Karte als Rueckkanal-Vorschau.

Produktentscheidung:

- Briefings bekommen spaeter eine eigene Vollseite.
- Briefings werden nicht als kleine Dashboard-Card dargestellt.
- Dashboard bleibt fuer Betrieb, Status, Scan, Sync und Action-Queue-Ueberblick.
- Briefings dienen als Leseraum mit Annahme-/Ablehnungs- und Uebergabe-Workflow.

Naechster Schritt:

- Build ausfuehren.
- Danach echten Backend-Abruf fuer Pending Action Plans planen.

Build:

- `npm run build` erfolgreich.
- Frontend kompiliert mit neuer Action-Queue-Card.
- Runner-Ausfuehrung bleibt deaktiviert, bis Codex/KAI Bridge separat freigegeben wird.

## 2026-06-26 - KatoSync 2.0 REST-Bruecke angebunden

Projekt: KatoSync Desktop App
Status: Action Queue an KatoOS MCP Server angebunden

Ergebnis:

- KatoSync kann einen MCP Connector Token im macOS-Schluesselbund speichern.
- Die App nutzt standardmaessig `https://mcp.katoos.de` als MCP-Server.
- Die Action Queue fragt echte Pending Action Plans ueber die Worker-REST-Bruecke ab:
  - `GET /api/action-plans?status=pending_review&includeTasks=true`
  - `PATCH /api/action-plans/:id/status`
- Wenn kein MCP Token vorhanden ist oder der Server nicht erreichbar ist, faellt die UI auf lokale Demo-Action-Plans zurueck.
- Status-Aktionen bleiben Human-in-the-Loop:
  - pruefen bleibt lokal
  - ablehnen wird als `rejected` an den Server gemeldet
  - freigeben wird als `approved` an den Server gemeldet
- Keine lokale Runner-Ausfuehrung wurde aktiviert.

Naechster Schritt:

- In der App unter API den MCP Connector Token einmal speichern.
- Danach Action Queue aktualisieren und echte Mistral/MCP Action Plans pruefen.
- Danach Briefings als eigene Vollseite planen und nicht in eine kleine Dashboard-Card pressen.

Build:

- `npm run build` erfolgreich.
- `cargo check` in `src-tauri` erfolgreich.

## 2026-06-26 - macOS Dock-Reopen Bug behoben

Projekt: KatoSync Desktop App
Status: Fenster-Lifecycle korrigiert

Problem:

- Wenn KatoSync ueber das Fenster-X ausgeblendet wurde, lief die App im Hintergrund weiter.
- Ein Klick auf das Dock-Icon brachte das versteckte Fenster nicht wieder nach vorne.
- Nutzer mussten die App komplett beenden und neu starten.

Fix:

- Tauri startet jetzt ueber `build(...).run(...)`, damit App-Lifecycle-Events abgefangen werden koennen.
- `RunEvent::Reopen` auf macOS zeigt das Hauptfenster wieder an.
- Das Fenster wird beim Dock-Klick:
  - wieder sichtbar gemacht
  - aus minimiertem Zustand geholt
  - fokussiert
- Der bestehende Hintergrundmodus beim Fenster-X bleibt erhalten.

Validierung:

- `cargo check` in `src-tauri` erfolgreich.

## 2026-06-26 - Action Queue zeigt nur offene Pläne

Projekt: KatoSync Desktop App
Status: Queue-UX korrigiert

Problem:

- Nach `Tagesplan freigeben` oder `Ablehnen` waren die Action Plans technisch erledigt.
- Der Queue-Zähler sprang auf `0`, aber die erledigten Karten blieben sichtbar.

Fix:

- Die Action Queue rendert nur noch offene Pläne:
  - `pending_user_review`
  - `in_review`
- Freigegebene und abgelehnte Pläne erscheinen als Zusammenfassung in den Aktivitäten.
- Bei leerer Queue zeigt KatoSync einen klaren erledigt-Hinweis.

Nächster Schritt:

- Build prüfen.
- Danach App erneut bauen/installieren, damit der lokale Test dieselbe Version nutzt.

## 2026-06-26 - KatoSync 2.0 Navigation und Briefings-Seite strukturiert

Projekt: KatoSync Desktop App
Status: Informationsarchitektur für 2.0 verdichtet

Ergebnis:

- Die Navigation wurde auf die produktrelevanten Hauptbereiche fokussiert:
  - `Dashboard`
  - `Action Queue`
  - `Briefings`
  - `Einstellungen`
  - `Aktivitäten`
- Lose Detailseiten wie `Library`, `Ordner` und `Regeln` werden nicht mehr als eigene Hauptseiten geführt.
- Dashboard bleibt kompakt für Betriebsstatus, Action-Queue-Überblick, Projektordner, Uploadplan, Sync und gefundene Dateien.
- Einstellungen bündelt Mistral-Zugang, Library-ID, MCP-Server, MCP Connector Token, Sync-Regeln und vorbereitete Codex-Bridge.
- Briefings haben eine eigene Vollseite mit Liste links und lesbarem Bericht rechts.
- Briefings können angenommen, abgelehnt oder für Codex vorbereitet werden.
- Die UI-Cards wurden auf symmetrischere Grid-Spalten und kompaktere responsive Breakpoints ausgerichtet.
- Der native Tauri-Rückkanal für Briefings wurde vorbereitet:
  - `load_remote_briefings`
  - `update_remote_briefing_status`

Sicherheitsentscheidung:

- Die Codex Bridge bleibt vorbereitend und startet noch keine lokale Ausführung.
- Briefings und Action Plans bleiben Human-in-the-Loop.
- MCP Briefings fallen bei fehlendem Backend-Endpunkt stabil auf lokale Demo-Daten zurück.

Validierung:

- `npm run build` erfolgreich.
- `cargo check` in `src-tauri` erfolgreich.

Nächster Schritt:

- Backend-Endpunkte für Briefings im KatoOS MCP Server finalisieren.
- Danach Briefings live aus Supabase/Worker laden.
- Anschließend Codex CLI Bridge mit manueller Freigabe und Audit-Log anbinden.

## 2026-06-27 - Briefings live aus dem MCP-Server

Projekt: KatoSync Desktop App + KatoOS MCP Server
Status: Briefing-Rückkanal end-to-end live (Demo-Fallback abgelöst)

Ergebnis:

- Die Briefing-Endpunkte im KatoOS MCP Server sind gebaut, deployed und live verifiziert:
  - Supabase-Tabelle `briefings` (Migration `0003_add_briefings.sql`) mit Status `new`/`accepted`/`queued`/`rejected`/`archived` und Priority `low`/`medium`/`high`/`critical`.
  - MCP-Tool `create_briefing` (Mistral Work pusht Briefings, analog `create_pending_action_plan`).
  - REST-Routen `GET /api/briefings?includeArchived=false` und `PATCH /api/briefings/:id/status`.
- Die App-Seite war bereits vollständig vorbereitet: Frontend, Repository-Schicht und die nativen Tauri-Commands `load_remote_briefings` und `update_remote_briefing_status` laden jetzt echte Live-Briefings statt der lokalen Demo-Daten.
- Der bestehende MCP Connector Token funktioniert direkt auch für Briefings (gleiche Bearer-Auth wie die Action Queue).
- Ein echtes Test-Briefing liegt in der Prod-DB (Status `new`), damit die Briefings-Seite sofort Live-Daten zeigt.

Sicherheitsentscheidung:

- Der Server ruft Mistral nicht selbst auf und führt nichts lokal aus; Briefings werden von Mistral Work über das MCP-Tool gepusht.
- Briefings bleiben Human-in-the-Loop; die Codex Bridge bleibt vorbereitend.

Validierung:

- Server: `npm run typecheck` und `npm test` (18 Tests) erfolgreich.
- Supabase-Migration `0003` live angewendet, Worker deployed (Version `c98e853b-f765-470e-807c-8ecf16e8d29a`).
- Live-Test: `create_briefing` (created + idempotenter Replay `created:false`), `GET /api/briefings` im erwarteten Feldformat, `PATCH /api/briefings/:id/status` mit nicht-leerer JSON-Antwort.

Nächster Schritt:

- In Mistral Studio die Work Skills so verdrahten, dass sie `create_briefing` produktiv aufrufen.
- Danach Codex CLI Bridge mit manueller Freigabe und Audit-Log anbinden.

## 2026-06-27 - Self-Service Connector-Token über KatoOS-Login

Projekt: KatoSync Desktop App + KatoOS MCP Server
Status: Self-Service-Token-Generator gebaut (Login statt manuellem Token-Paste)

Ergebnis:

- KatoSync hat jetzt einen echten Login: Nutzer melden sich mit ihrem bestehenden KatoOS-Konto an (geteiltes Supabase-Projekt, SSO mit Website/KSP/KAI/iOS).
- Über den Button „Connector-Token generieren" erzeugt der Nutzer seinen eigenen Token selbst — kein manuelles Einfügen, kein Admin-Token im Client.
- Server-seitig neu: `POST /api/me/connector` (verifiziert das KatoOS-User-JWT, löst/provisioniert den Tenant 1:1, rotiert alte Tokens, gibt den Token einmalig zurück).
- App-seitig neu: Rust-Commands `login_supabase` / `mint_connector_token` / `logout_supabase`, Refresh-Token im macOS-Schlüsselbund, Login-+-Generieren-Karte in den Einstellungen. Das manuelle Token-Feld bleibt als Fallback.

Architektur-/Sicherheitsentscheidung:

- Geteilter KatoOS-Login wiederverwendet (kein Auth-Insel-Projekt).
- 1 Tenant pro Nutzer (auto), 1 aktives Token mit harter Rotation, unbefristet, nur Login.
- Admin-Provisioning-Token und Service-Role-Key bleiben strikt server-only; nur der öffentliche Anon-Key liegt im Client.

Validierung:

- Server: `npm run typecheck` + `npm test` grün, Migration `0004_decouple_auth` live, Worker deployed (`b85f11d7`), 401-/GoTrue-Pfade live verifiziert.
- App: Frontend-Build + `cargo check` grün, Release gebaut und nach `/Applications` installiert.
- Happy-Path (Login → Token generieren → Briefings live) wird mit echtem KatoOS-Konto in der App getestet.

Nächster Schritt:

- Mit KatoOS-Konto in KatoSync einloggen, Token generieren, denselben Token im Mistral-Connector eintragen, Laura ausführen → Briefing erscheint live.
- Danach Codex CLI Bridge.

## 2026-06-27 - Codex-Bridge v1 + Markdown-Rendering der Briefings

Projekt: KatoSync Desktop App + KatoOS MCP Server
Status: Codex-Bridge v1 gebaut (lokale Ausführung freigegebener Aufgaben)

Ergebnis:

- Briefings rendern jetzt echtes Markdown (react-markdown + GFM): Überschriften, Tabellen, Listen sauber statt Roh-`##`/`|`.
- Neue Codex-Bridge: gemeinsame Rust-Engine `run_codex_task` (src-tauri/src/lib.rs), angebunden an BEIDE Auslöser — „Codex" pro Action-Task (Runner codex_cli) und „An Codex übergeben" im Briefing.
- Ablauf: Preflight (Codex-Login, Git-Repo, sauberer Baum, Repo-Allowlist aus sourceRoots, kritische Aufgaben werden abgebrochen) → eigener Branch `katosync/<projectId>/<datum>/task-…` → Run-Ordner `.katosync/runs/…` (input_plan.json, prompt.md, output.txt, execution_log.jsonl, changed_files.json, result_summary.md, status_update.md) → `codex exec` (Sandbox workspace-write, Timeout) → Auto-Commit auf den Branch (kein Merge) → Rückkanal an den Server.
- Wirtschaftlich: läuft über den Codex/ChatGPT-Login — keine zusätzlichen API-/Mistral-Kosten.
- Server-Rückkanal: neuer Endpunkt `POST /api/execution-results` (Migration 0005) + Action-Plan-Status running/completed/failed. CodexBridgePanel zeigt Status, Branch, geänderte Dateien und result_summary.

Sicherheitsentscheidung:

- Eigener Branch + Sandbox; kein Auto-Merge, nie auf main; kritische Aufgaben nur manuell; kein API-Key/Secret im Client.

Validierung:

- Server: typecheck + 20 Tests grün, Migration 0005 live, deployed (`bc072501`), Endpunkt live verifiziert (201/Idempotenz/Tenant/400/401).
- App: Frontend-Build + `cargo check` grün, Release gebaut + nach `/Applications` installiert.
- Codex-Invocation real verifiziert (Login, Flags, JSON-Events). Echter Schreib-Lauf aktuell durch ChatGPT/Codex-Nutzungslimit blockiert (Reset 30.06.) — die Engine behandelt das sauber als `failed` inkl. Klartext-Meldung.

Nächster Schritt:

- Sobald Codex-Kontingent verfügbar (oder Upgrade): echten Task an Codex übergeben → Branch + Commit + execution_results prüfen.
- Politur: echte Komponenten (Ampel/Balken/Diagramme) für Briefings; Auto-Merge/PR optional.

## 2026-06-27 - Codex-Bridge LIVE im GUI verifiziert + Allowlist gelockert

Projekt: KatoSync Desktop App
Status: Codex-Bridge v1 end-to-end im GUI erfolgreich

Ergebnis:

- Echter GUI-Lauf: Briefing → „An Codex übergeben" → `KatoOS Sync app` → Codex hat ~5 Min gearbeitet (130 Events), 5 Dateien echt geändert (tauri.conf.json Hardened Runtime, Entitlements.plist, RELEASE_OWNER_RUNBOOK.md, release-env.example.sh, README) und **auto-committet auf Branch `katosync/...`** (Commit c13e711, nicht main, kein Merge). Run-Ordner `.katosync/runs/...` mit allen Audit-Dateien angelegt.
- sourceRoots-Allowlist entfernt: der Nutzer wählt den Ordner bewusst im Datei-Dialog (= Freigabe); Schutz über Git-Repo-Pflicht, sauberen Baum, eigenen Branch, Sandbox, critical-Abbruch.
- Animierte „Codex läuft …"-Anzeige im Briefing + Codex-Bridge-Panel.
- Token-Hinweis: nach App-Neu-Builds kann der Schlüsselbund-Zugriff neu bestätigt werden müssen („Immer erlauben"); NICHT neu generieren (harte Rotation entwertet sonst den Mistral-Token).

Offen / nächste Phase (PROJEKT-BOARD + Politur):

- Live-Aktivitäts-Feed statt indeterminiertem Balken (Codex-JSONL-Events via Tauri-Events streamen).
- Branch immer von main/default abzweigen (nicht vom aktuellen Branch) + danach zurück auf main.
- Doppeltes `katosync/katosync/` im Branchnamen kürzen (bei Briefings projectId-Prefix weglassen).
- „Repo pro Projekt merken" / Auto-Detect (kein Ordnerwählen mehr pro Lauf).
- Optional: Branch auto-pushen + PR via gh erstellen.
- GROSS: Projekt-Board — Mistral liefert pro Projekt strukturierte Tasks (create_pending_action_plan mit tasks[projectId,priority,risk]); KatoSync gruppiert nach Projekt, Triage (auswählen/Reihenfolge/aufschieben/ablehnen), Task-Status-Endpunkt im Server, sequentielle Queue mit dailyLimit. Briefing bleibt Leseschicht (briefings.action_plan_id verlinkt).

Commit-Regel: Nur NMKato als Autor, KEIN „Co-Authored-By: Claude".
