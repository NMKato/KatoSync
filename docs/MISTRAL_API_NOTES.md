# Mistral API Notizen

Geprüfte offizielle Endpunkte:

- Libraries listen: `GET https://api.mistral.ai/v1/libraries`
- Library testen: `GET https://api.mistral.ai/v1/libraries/{library_id}`
- Dokument hochladen: `POST https://api.mistral.ai/v1/libraries/{library_id}/documents`
- Dokumentstatus: `GET https://api.mistral.ai/v1/libraries/{library_id}/documents/{document_id}/status`
- Workflow Runs: `GET https://api.mistral.ai/v1/workflows/runs`
- Workflow Run Detail: `GET https://api.mistral.ai/v1/workflows/runs/{run_id}`
- Workflow Schedules: `GET/POST/PATCH/DELETE https://api.mistral.ai/v1/workflows/schedules`

Wichtig für Version 1.0:

- KatoSync löscht keine Dokumente aus Mistral.
- Uploads laufen in stabiler CURRENT-Reihenfolge.
- Dokumente werden als `multipart/form-data` mit Feld `file` gesendet.
- HTTP 429 wird mit Backoff behandelt.
- API-Key wird nicht geloggt und nicht in `config.json` gespeichert.
- Free- und Scale-Limits werden nicht hart codiert, weil sie je Plan, Modell und Organisation variieren.
- KatoSync liest `X-RateLimit-*` Header aus echten API-Antworten und zeigt sie als Live-Kontingent an, sobald Mistral sie liefert.

Quellen:

- https://docs.mistral.ai/api/endpoint/beta/libraries
- https://docs.mistral.ai/api/endpoint/beta/libraries/documents
- https://docs.mistral.ai/api/endpoint/workflows/runs
- https://docs.mistral.ai/api/endpoint/workflows/schedules
