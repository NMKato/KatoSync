# Stage 4D — echtes M2/M3 Geräteverzeichnis sichtbar machen

**03.11.2026 · native Rust QA-Korrektur, gestapelt auf Stage 4C**

## Live-Befund

- Neues KATOOS-Gerätelimit 10 für das bestehende autorisierte Testkonto; zwei heute registrierte Stage3X-Identitäten, ältere QA-Geräteeinträge sicher entfernt.
- Die Supabase-Datenbank liefert \`GET /rest/v1/mesh_devices\` erfolgreich (HTTP 200) bei realen M2/M3-Läufen. Die React-App meldete dennoch eine nicht verfügbare Geräte-Registry.
- Codevertrag vor Fix: PostgREST beantwortet \`select=device_id,owner_user_id,display_name,persona_name,platform_os,membership_state,fingerprint,last_seen_at\` mit **snake_case**-Schlüsseln. Rust \`MeshDirectoryDevice\` nutzt jedoch \`serde(rename_all="camelCase", deny_unknown_fields)\` für Deserialisierung und Frontend-Serialisierung zugleich. Dadurch scheitert das Parsen der realen Antwort und zeigt nur den generischen Fehler.
- Keine Token- oder Netzwerkfehler für den GET belegt; die Registrierungs-Endpoint-Funktion v4 und ihre RLS bleiben unverändert.

## Korrektur

- Nur exakt erlaubte \`#[serde(alias="...")]\` für die sieben vom DB-Feldnamen abweichenden Rust-Felder. Keine Umbenennung von DB-Spalten, keine neue Tabelle, keine Änderung am JSON, das das React-Frontend in camelCase erwartet.
- \`deny_unknown_fields\` bleibt aktiv, doppelte aliasierte Namen werden abgewiesen. Das vorhandene Owner-/Fingerprint-/Status-/Revoke-Validierungsmodell bleibt bestehen.
- Native Rust-Unit-Test mit realistischem PostgREST-Schema testet snake_case ➜ strenge Validierung ➜ camelCase zurück an die UI; negativer Test prüft Aliasduplikate. Node-Kontraktprüfung ergänzend.
- Kein zusätzlicher Netzwerkserver, kein automatischer Trust, Pairing oder Remote-Job.
- Noch nicht in die signierte/notarisierte Stage3X-App übertragen: Stage4D erfordert neuen Test-Build, vollständige Apple-Notarisierung und realen M2/M3-Rostertest vor Freigabe.
