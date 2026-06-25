# KatoSync Memory

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
