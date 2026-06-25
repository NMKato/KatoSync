# KatoSync 2.0 - Agent Action Hub Plan

## Ziel

KatoSync 2.0 erweitert den bestehenden lokalen Mistral-Library-Uploader zu einem kontrollierten Agent Action Hub.

Der bestehende Sync-Kern bleibt erhalten:

- Projektordner scannen
- relevante Status-, Memory-, Roadmap- und Task-Dateien erkennen
- Secrets filtern
- CURRENT-Dateien erzeugen
- Mistral Library aktualisieren
- lokale Logs schreiben

Neu kommt der Rueckkanal:

```text
Mistral Work
-> KatoSync MCP Server
-> Supabase Action Plans
-> KatoSync Desktop Action Queue
-> lokale Freigabe
-> Codex CLI / Codex Desktop / KAI Desktop
-> Ergebnisdateien und Statusflow
-> naechster KatoSync Sync
```

## Architekturentscheidung

KatoSync bleibt der lokale Kontrollpunkt. Der MCP-Server darf Action Plans speichern, aber keine lokalen Aktionen direkt ausfuehren.

Pflichtregel:

- Mistral analysiert und plant.
- Der MCP-Server speichert strukturierte Plaene.
- KatoSync zeigt Plaene an.
- Der Mensch gibt lokal frei.
- Lokale Runner arbeiten nur nach Freigabe.
- Kein automatischer Merge, keine automatische E-Mail, keine finale Behoerden-/Finanz-/Rechtsabgabe.

## Phase 1 - Datenmodell und Action Queue

Ziel: KatoSync kann Action Plans lokal darstellen, zuerst mit Mock-Daten und danach mit Backend-Daten.

Neue Modelle:

- `ActionPlan`
- `ActionTask`
- `ExecutionLog`
- `ProjectRegistryEntry`

Neue UI:

- Navigationspunkt `Action Queue`
- Karten fuer neue Plaene
- Detailansicht fuer Aufgaben
- Risikoampel
- Aktionen: `Pruefen`, `Bearbeiten`, `Ablehnen`, `Zur Ausfuehrung freigeben`

Noch keine automatische Ausfuehrung in Phase 1.

## Briefings als eigene Vollseite

Agentenberichte sind kein kleines Dashboard-Widget. Wenn Mistral Work spaeter fertige
Briefings ueber den Rueckkanal liefert, bekommt KatoSync dafuer eine eigene Seite:

- Navigationspunkt `Briefings`
- Vollbreite Leseansicht statt kompakter Card
- Liste der eingegangenen Briefings nach Agent, Datum und Prioritaet
- Detailansicht fuer das komplette Briefing
- Aktionen:
  - `Annehmen`
  - `Ablehnen`
  - `In Action Queue uebernehmen`
  - `An Codex/KAI vorbereiten`

Produkttrennung:

- `Dashboard`: Betrieb, Setup, Sync, Scan, Status und Action-Queue-Ueberblick.
- `Action Queue`: strukturierte Aufgabenplaene, die lokal freigegeben werden.
- `Briefings`: fertige Agentenberichte im Vollseiten-Lesemodus mit Freigabe-Workflow.

Auch bei Briefings gilt:

- Keine automatische lokale Ausfuehrung ohne Freigabe.
- Keine automatische E-Mail, Zahlung oder finale externe Aktion.
- Prioritaet steuert Reihenfolge, nicht automatische Autorisierung.

## Phase 2 - Backend-Anbindung

Ziel: KatoSync ruft Pending Action Plans aus dem KatoSync-Backend ab.

Backend:

- Production MCP Domain: `https://mcp.katoos.de`
- MCP Endpoint: `https://mcp.katoos.de/mcp`
- Supabase speichert `action_plans`, `action_tasks`, `execution_results`, `audit_logs`

Client-Regeln:

- Kein Supabase Service-Role-Key in KatoSync Desktop.
- Desktop braucht spaeter Tenant-/Device-Token oder Supabase Auth.
- Fuer MVP-2.0 kann ein lokaler Connector-/Tenant-Testtoken als Entwicklungsmodus genutzt werden.

## Phase 3 - Codex CLI Bridge

Ziel: KatoSync erkennt Codex CLI und kann freigegebene Code-Aufgaben kontrolliert starten.

Pruefungen:

- `codex --help`
- `codex exec --help`
- Projektpfad existiert
- Git vorhanden
- Arbeitsbaum sauber
- aktueller Branch ist nicht `main`, `master`, `production`, `develop` oder `release`

Branch-Schema:

```text
katosync/<projectId>/<YYYY-MM-DD>/task-<priority>-<slug>
```

Run-Ordner:

```text
Projektordner/.katosync/runs/<YYYY-MM-DD>/task-<id>/
```

Pflichtdateien:

- `input_plan.json`
- `prompt.md`
- `output.md`
- `result_summary.md`
- `execution_log.json`
- `changed_files.json`
- `status_update.md`

## Phase 4 - Statusflow Writer

Ziel: Jede ausgefuehrte Aufgabe schreibt einen nachvollziehbaren Status in das Projekt.

Neue bevorzugte Datei:

```text
KATOSYNC_STATUSFLOW.md
```

Weiterhin unterstuetzt:

- `CURRENT_MISTRAL_BRIEFING_SOURCE.md`
- `CURRENT_PROJECT_STATUS_ALL.md`
- `CURRENT_MEMORY_ALL.md`

## Phase 5 - KAI Desktop und KatoOS Bridge

Spaeter:

- Action an KAI Desktop uebergeben
- KatoOS Dashboard Card erstellen
- Ergebnis ueber kontrollierte API-Bridge zurueckschreiben

## Naechster Umsetzungsschnitt

Der erste sichere Schnitt fuer die App ist:

1. Typen fuer `ActionPlan` und `ActionTask` anlegen.
2. Repository-Funktionen fuer lokale Mock-Plans anlegen.
3. ViewModel um Action Queue State erweitern.
4. Dashboard um Action-Queue-Karte erweitern.
5. Navigationspunkt `Action Queue` einbauen.
6. Tests/Build ausfuehren.

Erst danach wird der echte Backend-Abruf angebunden.
