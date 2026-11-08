# KatoSync Stage 2T – Vollständiger signierter Mesh-Inbox-Edge→PostgreSQL-End-to-End-Test

**30.10.2026. Separater gestapelter Draft nach Stage 2S / PR #185. Keine Änderungen am gemeinsamen Supabase-Projekt oder an M2/M3-Apps.**

## Anlass und Reichweite

Die bisherigen Tests hatten die Sender-Edge-Funktion, die Empfänger-Edge-Funktion und die SQL-Migrationen teilweise **separat** geprüft. Der neue QA-Modus verknüpft beide produktiven Edge-Handler `submitSignedMeshInvite` und `handleMeshInboxReceive` mit **tatsächlich ausgeführten PostgreSQL-17-Abfragen**. Der Auth-/Mitgliedschafts- und PostgREST-HTTP-Teil wird durch einen eng begrenzten, lokalen Adapter ersetzt. Seine REST-Verarbeitung erstellt echte PostgreSQL `INSERT`-, `SELECT`- und `UPDATE`-Transaktionen unter `SET ROLE service_role`. Die wirklichen Datenbank-Constraints, RLS/Grants, Trigger und konkurrierenden Schlüsselkontinuitätsregeln sind aktiv.

**Dies ist keine physische M2↔M3-Übertragung.** Der Test führt synthetische Mac-A/Mac-B-Identitäten auf einem isolierten M2-Prozess aus, generiert beide Ed25519-Schlüssel frisch und verwendet weder die vorhandenen Keychain-Seeds noch echte Supabase-Logins, Tokens oder Geräte. Das `xbnnly...`-URL-Muster in den Edge-Handlern wird im QA-Adapter ausschließlich lokal abgefangen; **es finden keine externen HTTP-Aufrufe statt**.

## Durchführung

```bash
bash scripts/qa-mesh-postgres-local.sh inbox-edge-e2e
```

- Erzeugt `/tmp/ksmeshqa.XXXXXX` mit Modus `0700`, startet PostgreSQL 17 mit `listen_addresses=''` und Unix-Socket im temporären Ordner. Eine absichtlich scheiternde TCP-127.0.0.1-Probe bestätigt, dass der Cluster nicht über TCP erreichbar ist.
- Die Fixture `tests/sql/mesh_inbox_edge_e2e_setup.sql` erstellt nur im temporären Cluster synthetische `auth.users`-Zeilen, Testrollen und die **fünf realen SQL-Dateien**: Basis-Mesh-Schema plus die vier Inbox-Migrationen 2L, 2O, 2O.1, 2S. Die Testumgebung verweigert direkte `authenticated`-Inbox-/Proof-Writes.
- Der Node-Runner `tests/meshInboxEdgePostgresE2e.qa.ts` benötigt das **explizite** `KATOSYNC_MESH_E2E_ALLOW=EPHEMERAL_UNIX_SOCKET_ONLY` und einen `/tmp/ksmeshqa.[A-Za-z0-9]{6}`-Unix-Socket auf dem fixen QA-Port. Bei unvollständiger Freigabe beendet er sich ohne Datenbankkontakt.
- Für beide synthetischen Geräte generiert WebCrypto unabhängige Schlüssel, ein signiertes Originalangebot (Ed25519), eine separate Source→Target-Dispatchsignatur und frische Nonce-gestützte Empfänger-Proofs für LIST/ACCEPT/REJECT. Keine Keychain-/Service-Role-Tokens werden aufgerufen.
- Alle nicht freigegebenen API-Routen sowie andere HTTP-Origins lösen Testfehler aus. Nur die festen `auth/v1/user`, `account_memberships`, `mesh_devices`, `mesh_invites` und `mesh_inbox_proofs`-Routen werden vom **lokalen Adapter** behandelt; Auth und Mitgliedschaft werden synthetisch simuliert, DB-Einladungen/Proofs dagegen **tatsächlich in PostgreSQL geschrieben**.
- Der temporäre Datenbankserver wird per `trap cleanup EXIT INT TERM` abgeschaltet und der QA-Ordner gelöscht.

## Tatsächliche E2E-Abnahmen

| Szenario | Erwartete Prüfung |
|---|---|
| Frische signierte Einladung A→B | `202`, ein Datenbankeintrag `pending`, `paired=false` |
| Signierte Empfänger-LIST | `200`, genau die originale Einladung mit gültiger ursprünglicher Absendersignatur und registriertem Key |
| Signierte ACCEPT-Entscheidung | `200 accepted` nach Single-Use-Proof und vier realen Migrationen |
| Replay der identischen Empfängersignatur | `409` (Nonce bereits verwendet) |
| Neue, widersprechende REJECT-Entscheidung für angenommene Einladung | `409`, DB bleibt `accepted` |
| Zweite Einladung und REJECT | `200 rejected`, DB-Entscheidung gültig |
| Dritte Einladung mit inzwischen rotiertem Absender-Key | LIST liefert `503 INBOX_SOURCE_UNVERIFIED` und keine Angebote |
| Empfänger-Key-Rotation nach gespeichertem Proof, aber vor PATCH | Der reale Stage-2S-Datenbanktrigger verweigert UPDATE; `503 INBOX_UNAVAILABLE`, Einladung bleibt `pending` |
| Ergebnis in DB | 3 tatsächliche Einladungszeilen, **0 trusted devices**, keine Remote-Jobs |

Erfolgsmarker: **`MESH_EDGE_PG_REAL_SQL_ED25519_E2E_PASS`** und **`MESH_QA_ALL_SQL_ASSERTIONS_PASSED`**. Drei zusätzliche reguläre Node-Contract-Tests überprüfen die Opt-in-Sperre, die lokale Socket-Eingrenzung, Cleanup und den vollständigen Migrations-Stack.

## Einschränkungen und nächster Freigabeschritt

Die PostgreSQL-Abfragen unter service_role validieren die echte Trigger-/Spalten-/Grant-Interaktion. Sie sind **keine** Tests des echten PostgREST-Servers, der Supabase-Auth-JWT-Ausgabe, realer Mitgliedschaft, echter Keychain-Pins, zweier physischer Macs oder von Netzwerkzustellung. Die parallelen Tests können keine Garantie über Produktions-Timing, race conditions auf mehreren Datenbankinstanzen oder Netzwerkausfälle abgeben. Beide Mac-QA-Apps bleiben byte-identisch und unverändert.

Nach erfolgreicher PR- und unabhängiger QA-Abnahme steht weiterhin ein **separat kontrollierter Schema-/Edge-Rollout** im gemeinsamen Supabase-Projekt aus. Erst danach und nur mit autorisiertem QA-Fenster folgen ein realer M2→M3-Invite, UI-Nachweis, beidseitiger Sicherheitscode (SAS), echte Keychain-Signaturen und authentifiziertes mTLS mit Widerrufsprüfung. **Keine automatische Kopplung, kein Reader und kein Writer.**
