# KatoSync Project Statusflow

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
