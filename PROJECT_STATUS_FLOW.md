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
