# KatoSync Stage 3H – signierter Relay-Rückweg (vorbereitete Infrastruktur)

**31.10.2026 · NMKato Solutions** · Auf Stage 3G / Draft-PR #199 aufbauend. **Nicht ausgerollt, keine produktive Kopplung.**

## Warum ein gesonderter Rückkanal?

Die vorhandenen Inbox-Edge-Funktionen `mesh-inbox-send` / `mesh-inbox-receive` erlauben bewusst nur eine signierte Einladung und ihre einzelne Annehmen-/Ablehnen-Entscheidung. Challenge und Response darin zusätzlich als ungesicherte Updates abzulegen würde die bisherigen SQL- und Ed25519-Beweise aufweichen.

Stage 3H ergänzt deshalb **eine vollständig getrennte, standardmäßig abgeschaltete Backend-Relay-Strecke** für öffentliche, kurzlebige `challenge`- und `response`-Nachrichten. Endnutzer-KatoSync-Apps senden noch nicht automatisch über diesen Dienst; der neue native Sender/Empfänger und seine UI folgen in Stage 3I.

## Sicherheitsvertrag

### Relay-Envelope `katosync-mesh-pairing-relay-v1`

`protocol, requestId, senderDeviceId, recipientDeviceId, kind, payloadB64, nonce, expiresAt, signature`.

Die äußere Ed25519-Signatur bindet in fester Reihenfolge:
`protocol|verifiedOwner|requestId|senderDeviceId|recipientDeviceId|kind|payloadB64|nonce|expiresAt`.

- `kind=challenge`: nur vom **adressierten Empfänger** der zuvor akzeptierten Einladung zurück an den **ursprünglichen Einladenden**. Beide müssen als `discovered` registriert und nicht widerrufen sein.
- `kind=response`: nur vom ursprünglichen Einladenden zurück zum Empfänger. Die SQL-Datenbank verlangt zuvor eine nicht abgelaufene Challenge **derselben Einladung**.
- Inhalt ist ausschließlich ein öffentliches, erneut verifiziertes Ed25519-Handshake-JSON (maximal 8 KiB). **Äußere Signatur und innere Challenge-/Response-Signaturen** werden unabhängig geprüft. Das ursprüngliche `MeshOffer` wird gegen Kontoskop, den registrierten Signaturschlüssel, Nonce und Ablaufzeit geprüft.
- Das Ablaufdatum des Transports liegt spätestens beim **inneren Challenge-Ablauf**, dem ursprünglichen Einladungsende und höchstens fünf Minuten nach Prüfung. Erfolgt die Zustellung zu spät, fällt sie geschlossen aus.
- PostgreSQL gibt `jsonb`-Felder eventuell anders sortiert zurück als Rust-Serde. Vor Hashes baut der Edge-Verifier aus den **typisierten** Feldern die feste Rust-v1-Reihenfolge nach. Zwei zusätzliche Regressionstests bestätigen, dass gültige signierte Nachrichten bei umsortiertem öffentlichen JSON nicht fälschlich scheitern; manipulierte Feldwerte weiterhin schon.

### Native Sender-/Empfänger-Autorisierung (serverseitig vorbereitet)

Der Edge-Handler `mesh-pairing-relay` akzeptiert nur `POST` und ausschließlich bei **`KATOSYNC_MESH_PAIRING_RELAY_STAGE=qa-relay`**. Zusätzlich erforderlich: kanonische Supabase-URL, gültige Online-JWT-Abfrage `/auth/v1/user`, verifizierte aktive KatoSync-Mitgliedschaft, beide öffentlichen Geräteidentitäten im owner-scoped Registry-Roster sowie eine bereits **angenommene, gültige** Einladung. Keine Service-Key-Ausgabe an die App.

`action=send` überprüft alle Signaturen und legt die öffentliche Nachricht dienstseitig ab; DB-Unique-Constraints erlauben pro Einladung und Nachrichtenart nur **einen** Datensatz.

`action=list` verlangt zusätzlich eine neue Ed25519-Signatur des tatsächlich abfragenden Empfängergeräts mit gebundenem Konto, Geräte-ID, frischer Nonce und sehr kurzer Ablaufzeit. Jede Lesesignatur wird einmalig in `mesh_pairing_relay_reads` registriert; Replay und mehr als zwölf Abrufe pro Minute und Gerät werden atomar abgewiesen. Vor der Ausgabe werden **alle** gelesenen Nachrichten erneut gegen den aktuellen Geräte-/Einladungszustand und beide Signaturen geprüft. Maximal zehn Nachrichten pro Abruf. **Kein Hintergrundpolling in KatoSync implementiert.**

### Datenbank

Neue **separate und noch nicht eingespielte** Migration `20261031213900_mesh_pairing_relay_staged.sql` legt `mesh_pairing_relay_messages` und `mesh_pairing_relay_reads` im isolierten Schema `katosync` an. Bei beiden Tabellen: **RLS aktiv**, `anon` und `authenticated` besitzen **keine** direkten Lese-/Schreibrechte, nur `service_role` darf lesen/anlegen. Foreign Keys, bedingte Before-Insert-Guards, Owner-/Rollenbindung, widerrufene Geräte, einmalige Schritte, Nonce-Replay-Schutz, Ablaufzeiten und transaktionale Lese-Limits werden auf Datenbankebene abgesichert. Weder Datenbank noch Edge-Rückmeldung enthalten ein `paired=true`, mTLS-Freigabe oder Fernauftragsrecht.

## Tatsächlich durchgeführte isolierte QA

1. **Echtes WebCrypto Ed25519** in Node: korrekte Challenge und Response sowie Ablehnung bei fremdem Owner, vertauschten Rollen, manipuliertem verschlüsselungsfreiem öffentlichen Material, falschen Signaturen und zu spätem Ablauf.
2. **Mocked Edge/PostgREST** mit realen Signaturen: Challenge von B→A speichern, signierten Lesebeleg von A, Response von A→B speichern und signiert von B lesen; Dubletten 409, ungültige Inbox-/Gerätezustände 403/503, Replay der Lesesignatur 409. **Kein Live-Request**.
3. **Reales PostgreSQL 17** in einem vorübergehenden `0700`-Unix-Socket-Verzeichnis **ohne TCP-Listener**: alle bisherigen Mesh-Migrationen plus Stage3H tatsächlich angewendet, Konto- und Gerätemuster rein synthetisch. RLS-/GRANT-Abschirmung, ausstehende Challenge, falsche Senderrichtung, bereits benutzte Nachrichtenart, Widerruf, Signatur-Nonce-Einmaligkeit, Limit nach zwölf Leseaktionen explizit geprüft. Ausgabe: `MESH_RELAY_LOCAL_SQL_SECURITY_PASS`, `MESH_QA_ALL_SQL_ASSERTIONS_PASSED`. Cluster nach Abschluss automatisch gelöscht.
4. Bestehende Node-/TypeScript-/Web-Build-Regressionen und Windows-CI sind Bestandteil der jeweiligen PR-Prüfung. **Keine** Änderung der Rust-App-Kommando-Registrierung in dieser Stage, keine Änderung von Benutzer-Keychain-Einträgen.

## Offene Grenzen / Stage 3I

- Die verifizierte Cloud-Strecke ist **nur Quellcode und isoliertes QA**. Die neue Edge-Funktion und Migration wurden nicht im gemeinsamen KATOOS-Supabase-Projekt veröffentlicht.
- Noch fehlen die **authentifizierten nativen Tauri-Send-/List-Commands**, Geräte-Auswahl/Status auf beiden Macs, sichere automatische Nachrichtenanzeige und explizite Aktionen zur Übergabe an die vorhandenen `mesh_pairing_response_create` / `mesh_pairing_response_verify`-Kommandos.
- SAS-Vergleich, **beidseitige echte Zustimmung**, dauerhaftes Device-Keychain-Pinning, verifizierte TLS-Session, Wiederverbindung, Remote-Jobs und Widerruf müssen getrennt getestet und freigegeben werden.
- Das M3 ist online, aber `/Volumes/DevSSD` wurde bei der Prüfung nicht gemountet; kein Schlüsselbund-/Volume-Unlock ohne Freigabe. Der M2 hatte während der Builds nur wenige GiB freien Speicher. Keine Auto-Merges/Installer/Produktivänderungen.

**Freigabeentscheidung:** Noch kein Deployment oder Release. Der bisherige produktive Snapshot lautet zwei `discovered`, null `trusted`; die vier früheren Inbox-Migrationen und die neue fünfte Relay-Migration sind nicht ausgerollt.
