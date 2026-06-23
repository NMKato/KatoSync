# Mistral Work Scheduler Analyse

Stand: 2026-06-23

## Ergebnis

KatoSync hat aktuell zwei unterschiedliche Scheduling-Ebenen:

1. **Lokaler Uploadplan**
   - läuft auf dem Mac per LaunchAgent
   - scannt lokale Ordner
   - erzeugt CURRENT-Dateien
   - lädt sie in die Mistral Library hoch

2. **Mistral Work Scheduler**
   - läuft in Mistral Work
   - startet Work-Aufgaben mit Prompt, Skills, Connectors, Libraries und Projects
   - erzeugt die eigentlichen Briefings/Reports

Die aktuelle KatoSync-Version steuert nur Ebene 1.

## Was laut Mistral API möglich ist

Die API bietet Workflow-Schedules:

- `GET /v1/workflows/schedules`
- `POST /v1/workflows/schedules`
- `GET /v1/workflows/schedules/{schedule_id}`
- `PATCH /v1/workflows/schedules/{schedule_id}`
- `POST /v1/workflows/schedules/{schedule_id}/pause`
- `POST /v1/workflows/schedules/{schedule_id}/resume`
- `POST /v1/workflows/schedules/{schedule_id}/trigger`
- `DELETE /v1/workflows/schedules/{schedule_id}`

Dazu gibt es Workflow-Runs:

- `GET /v1/workflows/runs`
- `GET /v1/workflows/runs/{run_id}`
- `GET /v1/workflows/runs/{run_id}/history`

Das bedeutet: Eine spätere KatoSync-Version kann wahrscheinlich Workflow-Schedules listen, auslösen, pausieren, fortsetzen und Zeiten ändern, wenn diese Schedules als Mistral Workflow-Schedules sichtbar sind.

## Was unklar oder nicht als API belegt ist

In der veröffentlichten OpenAPI-Spezifikation wurden keine direkten Endpunkte für diese Work-UI-Ressourcen gefunden:

- Skills erstellen/bearbeiten
- Work Projects erstellen/bearbeiten
- Work Scheduled Tasks mit Skill-Tags und Projektordnern direkt als UI-Aufgabe erstellen

Die Work-Doku sagt, dass Scheduled Tasks in Work laufen und Workflows-Infrastruktur darunter nutzen. Das heißt aber nicht automatisch, dass jede Work-UI-Aufgabe 1:1 über die Workflow-Schedules-API vollständig bearbeitbar ist.

## Empfehlung

Version 1.0 bleibt beim lokalen Uploadplan.

Version 1.1 sollte ein Mistral-Modul bekommen:

- vorhandene Workflow-Schedules listen
- Schedule-Zeiten bearbeiten, wenn API-Zugriff funktioniert
- Schedule manuell triggern
- Schedule pausieren/fortsetzen
- Workflow Runs auslesen und Reports lokal anzeigen

Version 1.2 kann dann prüfen, ob das Erstellen kompletter Work-Aufgaben inklusive Prompt, Skill, Projekt und Bibliothek stabil über API abbildbar ist. Wenn nicht, bleibt KatoSync bei Presets und zeigt dem Nutzer an, welche Schritte einmalig in Mistral Work eingerichtet werden müssen.

## Produktentscheidung

Die UI sollte klar trennen:

- **Uploadplan:** Wann KatoSync neue CURRENT-Dateien nach Mistral hochlädt.
- **Mistral Aufgaben:** Wann Mistral Work aus diesen Daten Reports erstellt.

So vermeiden wir, dass Nutzer denken, der lokale Uploadplan würde automatisch die Mistral-Work-Aufgaben David, Laura, Thomas oder Mai konfigurieren.

Quellen:

- https://docs.mistral.ai/vibe/work/scheduled-tasks
- https://docs.mistral.ai/vibe/work/workflows
- https://docs.mistral.ai/api/endpoint/workflows/schedules
- https://docs.mistral.ai/api/endpoint/workflows/runs
- https://github.com/mistralai/platform-docs-public/blob/main/openapi.yaml
