# KatoSync Memory

## Commit-Regel (wichtig)

- In Git-Commits NUR NMKato als Autor. KEIN `Co-Authored-By: Claude` o.ä. anhängen.

## Stand 2026-06-27 (Session-Ende)

- LIVE & funktionierend: (1) Briefings live aus dem MCP-Server (Markdown-Rendering), (2) Self-Service-Login (eigenes Supabase-Projekt, E-Mail-Registrierung) + „Connector-Token generieren", (3) Codex-Bridge v1 — Briefing/Action-Task → `run_codex_task` (Rust) → Preflight → eigener Branch → `codex exec` (Sandbox, ChatGPT-Login = keine API-Kosten) → Auto-Commit auf Branch (kein Merge) → Rückkanal `POST /api/execution-results`. Echter GUI-Lauf verifiziert (Commit c13e711, 5 Dateien).
- Codex-Bridge: KEINE sourceRoots-Allowlist mehr (Ordnerwahl im Dialog = Freigabe). Branch wird vom AKTUELLEN HEAD abgezweigt (TODO: von main). Branch wird NICHT gepusht (kein Auto-PR; manuell `git push` für PR).
- Schlüsselbund-Eigenheit: nach jedem App-Neu-Build (ad-hoc signiert) kann macOS den Token-Zugriff neu abfragen → „Immer erlauben"; NICHT neu generieren (harte Rotation entwertet sonst den in Mistral hinterlegten Token).
- Nächste große Welle = Projekt-Board (Briefings → pro-Projekt-Tasks von Mistral, Triage/Queue/aufschieben/ablehnen, Task-Status-Endpunkt, Live-Aktivitäts-Feed).

## Projekt-Board (live seit 2026-06-28)

- Neue Seite „Projekt-Board" (StepId `projectBoard`) NEBEN der Action Queue (die bleibt das plan-zentrierte Freigabe-Tor + Dashboard-Widget + Onboarding — bewusst NICHT umgebaut).
- `ActionTask` hat jetzt ein Pflichtfeld `status: ActionTaskStatus` (`pending/queued/running/completed/rejected/failed/deferred`). `projectId` = Server-`project_external_id` mit Sentinel `NO_PROJECT_ID` (`__no_project__` → Label „Ohne Projekt"). `priority` bleibt NUMBER = Rang aus `sort_order` (NICHT die textuelle Server-`priority`).
- Mapping-Helfer in `katoSyncRepository.ts`: `fromRemoteRunner` (Passthrough gegen App-`ActionRunner`-Union, Fallback `manual_review`), `fromRemoteTaskStatus` (`approved`→`queued`, sonst `pending`), `toRemoteTaskStatus` (Identität), `fromRemoteRisk` (`blocked`→`critical`, sonst `medium`). Lade-Query: `?status=pending_review,approved`. localStorage-Key-Bump `katosync.actionPlans.v2`.
- Task-Status-Rückkanal: Public `updateActionTaskStatus` → Tauri-Command `update_remote_action_task_status` (Keychain-Token) bzw. Browser-`fetch`-Fallback → `PATCH /api/action-tasks/:id/status`. `run_codex_task` (Rust) meldet zusätzlich `running`/final auf Task-Ebene (best effort, idempotent).
- ViewModel: `boardGroups` (gruppiert nach Projekt), `boardDailyLimit` (Max der approved-Plan-`dailyLimit`, Fallback 3), `dailyCount` (lokaler Zähler, Key `katosync.board.completed.<YYYY-MM-DD>` → Auto-Tagesreset). Handler: `handleSelectTask`/`handleReorderTask`/`handleDeferTask`/`handleRejectTask`/`handleResumeTask`/`handleStopBoardQueue`/`handleStartBoardQueue(projectId)`.
- Sequentieller Executor: PRO PROJEKT-SPALTE starten (ein Repo-Ordner je Lauf — Repo-pro-Projekt-Automatik ist NOCH NICHT drin), striktes `await` pro Task, lokaler Tageszähler im Loop (kein React-State-Stale-Closure), Fehler → `failed` + WEITER (continue), Stop bei Limit/Stop-Button. `critical`-Tasks sind aus dem Codex-Lauf ausgeschlossen.
- WICHTIG: Das Board führt nur Tasks **freigegebener** (`approved`) Pläne aus; offene Pläne erscheinen read-only mit Hinweis „in der Action Queue freigeben". Freigabe-Tor bleibt also am Plan.

## Projektkontext

KatoSync ist eine Tauri/macOS Desktop-App. Sie synchronisiert lokale Projektstatus-, Memory-, Roadmap- und Task-Dateien in eine Mistral Library.

Architekturstrategie:

- MVVM plus Repository
- UI-Komponenten wiederverwendbar halten
- Datenlogik, Business-Logik und View getrennt halten
- User-facing Texte auf Deutsch mit Umlauten

## Aktueller Stand

- KatoSync 1.x kann lokale Ordner scannen und CURRENT-Dateien erzeugen.
- KatoSync 1.x kann mit Mistral Library Uploads arbeiten.
- KatoSync MCP Server ist separat im Repo `KatoOS-MCP-Server`.
- MCP Production Endpoint: `https://mcp.katoos.de/mcp`
- Mistral Connector ist verbunden und sieht die drei MCP Tools.

## KatoSync 2.0 Ziel

KatoSync 2.0 wird zum Agent Action Hub:

```text
Mistral Work -> MCP Server -> Supabase -> KatoSync Action Queue -> lokale Freigabe -> Codex/KAI Runner
```

Zuerst bauen:

1. Action-Plan-Typen
2. Action-Queue-UI
3. lokale Mock-Daten
4. Backend-Abruf
5. Status-Updates
6. spaeter Codex CLI Bridge

## Umsetzung 2026-06-25

- Action-Plan- und Action-Task-Typen wurden in `src/types.ts` angelegt.
- `katoSyncRepository` liefert lokale Mock-Action-Plans und kann deren Status setzen.
- `useKatoSyncViewModel` laedt Action Plans beim Start und stellt sichere Aktionen bereit.
- Dashboard enthaelt eine breite `Action Queue`-Card mit Agent, Risiko, Top-Aufgaben und Freigabe-Buttons.
- `Action Queue` ist aktuell nur Anzeige/Freigabe-Vorbereitung, keine lokale Runner-Ausfuehrung.
- `npm run build` war erfolgreich.

## Umsetzung 2026-06-26

- KatoSync Desktop ist an die KatoOS MCP Worker-REST-Bruecke angebunden.
- Standard-MCP-Server in der Desktop-Konfiguration: `https://mcp.katoos.de`.
- MCP Connector Token wird in der Desktop-App separat vom Mistral API-Key im macOS-Schluesselbund gespeichert.
- Keychain-Account fuer den MCP Connector Token: `mcp-connector-token`.
- Neue Tauri-Kommandos:
  - `save_mcp_connector_token`
  - `mcp_connector_token_status`
  - `delete_mcp_connector_token`
  - `load_remote_action_plans`
  - `update_remote_action_plan_status`
- Repository-Strategie:
  - Wenn MCP Token vorhanden ist, laedt `loadActionPlans(config)` live vom Worker.
  - Ohne Token oder bei Netzwerkfehlern nutzt KatoSync lokale Demo-Plaene, damit die UI stabil bleibt.
  - `approved` und `rejected` werden an den Worker zurueckgeschrieben.
  - `in_review` bleibt lokal, weil der Backend-Status dafuer noch nicht existiert.
- Sicherheit:
  - Kein Supabase Service-Role-Key in der Desktop-App.
  - Kein automatischer Runner.
  - Kein direkter Codex/KAI-Start ohne separate Freigabe.

Validierung:

- `npm run build` erfolgreich.
- `cargo check` in `src-tauri` erfolgreich.

## Bugfix 2026-06-26

- macOS Dock-Reopen wurde repariert.
- Ursache: Das Fenster wurde beim Schliessen nur versteckt, aber es gab keinen Handler fuer `RunEvent::Reopen`.
- Loesung:
  - Tauri-App wird mit `build(...).run(...)` gestartet.
  - Bei macOS `RunEvent::Reopen` wird das `main`-Fenster wieder gezeigt, entminimiert und fokussiert.
- Wichtig:
  - Das Fenster-X beendet KatoSync weiterhin nicht.
  - Der rote Button `Programm beenden` bleibt der echte Quit-Pfad.

## Bugfix 2026-06-26 - Action Queue Anzeige

- Action Plans mit Status `approved` oder `rejected` duerfen nicht weiter als offene Queue-Karten sichtbar bleiben.
- Die Queue zeigt jetzt nur noch `pending_user_review` und `in_review`.
- Freigegebene und abgelehnte Plaene werden als Aktivitaeten zusammengefasst.
- Wenn keine offenen Action Plans vorhanden sind, zeigt die Queue einen klaren erledigt-Zustand.

## Sicherheitsnotizen

- Kein Supabase Service-Role-Key in der Desktop-App.
- Pending Action Plans duerfen angezeigt und geprueft werden, aber nicht automatisch ausgefuehrt werden.
- Code-Aufgaben duerfen nie direkt auf `main`, `master`, `production`, `develop` oder `release` laufen.
- Jede Ausfuehrung braucht Audit Log und Ergebnisdateien.
- Hochrisiko-Aufgaben gehen immer in manuelle Pruefung.

## Offene Produktfragen

- Login/Tenant-Modell fuer KatoSync 2.0 finalisieren.
- Desktop-Token-Strategie fuer Backend-Abruf definieren.
- Token-Generator fuer Mistral Connector in KatoSync-App bauen.
- Briefings vs. Action Plans in der UI trennen:
  - `Action Queue` bleibt fuer strukturierte Aufgabenplaene und Freigabe.
  - `Briefings` wird eine eigene Vollseite fuer komplette Agentenberichte.
  - Briefings koennen angenommen, abgelehnt oder in die Action Queue uebernommen werden.

## Umsetzung 2026-06-26 - 2.0 UI-Struktur

- KatoSync 2.0 nutzt jetzt eine klarere Hauptnavigation:
  - `Dashboard`
  - `Action Queue`
  - `Briefings`
  - `Einstellungen`
  - `Aktivitäten`
- Dashboard ist die kompakte Betriebsübersicht.
- Einstellungen ist der Ort für Zugangsdaten, Library, MCP Server, MCP Connector Token, Sync-Regeln und Codex-Bridge-Vorbereitung.
- Briefings sind eine eigene Leseseite, nicht nur eine kleine Dashboard-Card.
- Action Queue bleibt für strukturierte Action Plans mit lokaler Freigabe.
- Aktivitäten zeigt Logs und erledigte/freigegebene/abgelehnte Vorgänge.
- Die UI soll kompakt, symmetrisch und wie ein geordnetes Puzzle wirken: wenig ungenutzter White Space, aber weiterhin gut lesbar.
- User-facing Texte bleiben auf Deutsch mit Umlauten.
- Der native Desktop-Rückkanal für Briefings ist vorbereitet:
  - `load_remote_briefings`
  - `update_remote_briefing_status`
- `npm run build` und `cargo check` waren nach der UI-Strukturierung erfolgreich.

## Wichtige 2.0 Sicherheitslinie

- KatoSync darf lokale Runner wie Codex oder KAI nicht ohne ausdrückliche Nutzerfreigabe starten.
- Briefings dürfen angenommen oder vorbereitet werden, aber die automatische Ausführung kommt erst nach separater Bridge-Implementierung.
- Keine Service-Role-Secrets in der Desktop-App.
- MCP Connector Token wird lokal behandelt und nicht im Repository abgelegt.
