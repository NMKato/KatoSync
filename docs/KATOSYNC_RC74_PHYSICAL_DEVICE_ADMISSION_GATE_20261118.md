# RC74 – Physischer Geräte- und produktiver Owner-Admission-Befund

**18. November 2026 · read-only verifiziert · kein Deployment und keine Freigabeänderung**

## Entscheidung

**RC73 Source-QA: PASS.** Native macOS/Windows-GitHub-Tests auf `c24814e` jeweils 24/24 Rust und 24/24 Node PASS. Der echte lokale Ticket-WebSocket-Handshake und die unabhängig gepinnte Ed25519-Server-Challenge wurden geprüft; der QA-Socket schließt weiterhin bewusst mit 1008. Es existiert daraus **keine** Live-Mesh-Sitzung.

**RC74 Live Owner/Device Admission: BLOCKED.** Das ist ein **konkreter produktiver Datenbank-/Zulassungsblocker**, nicht ein weiterer Grund, einen eigenen Fake-Transport oder zweite Owner-Authority zu entwickeln.

## Physische macOS-Prüfung (read-only, M2 und M3)

Direkter, autorisierter Maschinencheck über den externen Desktop Commander **ausschließlich für lokale Diagnose, nicht als KatoSync-Gerätebackend**:

- **M2**: staged **KatoSync Stage4U Mesh QA** App läuft; der macOS-Security-Framework-Metadatencheck weist **genau einen** `mesh-ed25519-v1:`-Eintrag im Service `com.nmkato.katosync.katoos.auth.qa` nach.
- **M3**: staged **KatoSync Stage4X UX QA** App läuft; ebenfalls **genau ein** `mesh-ed25519-v1:`-Eintrag im Service `com.nmkato.katosync.katoos.auth.qa`. Zusätzlich ein älterer Legacy-Identitätseintrag unter `com.nmkato.katosync`, der **nicht** für den KatoOS-QA-Remote-Relay benutzt werden darf.
- Die Owner-Account-Kennungen der beiden KatoOS-QA-Mesh-Keychain-Einträge stimmen im Salted-SHA-256-Vergleich überein. **Keine UID, kein privater Schlüssel, kein Keychain-Passwort und kein Token wurde ausgegeben oder exportiert.**
- Vorhandensein der lokalen Identität beweist weder Serverregistrierung desselben Ed25519-Keys noch eine Owner-Freigabe. Die physisch laufenden Stage4U/Stage4X-Apps sind **nicht** der neue RC73-Desktop-Beta-Build.

## KatoOS-Supabase: ausschließlich produktive SELECT-Abfragen

Projekt **KatoOS**, Region EU-Central, Schema `katosync`. Keine DDL, kein INSERT/UPDATE, kein Service-Key-Export.

| Serverbefund | Ergebnis |
| --- | ---: |
| `mesh_devices` | 6 |
| Owner-Gruppen in `mesh_devices` | 1 |
| Plattform | 6 macOS, 0 Windows |
| `enrolled_at` gesetzt, `revoked_at` leer | 6 |
| `membership_state = 'discovered'` | **6** |
| `membership_state = 'trusted'` | **0** |
| `remote_mcp_client_grants` | **0** |
| `remote_mcp_device_consents` | **0** |
| `mesh_owner_policy` | 1 Datensatz, `enrollment_mode='manual'`, `owner_opt_in_verified=false` |

**Folge:** Es ist kein serverseitig genehmigter, widerrufbarer Remote-MCP-Gerätezutritt vorhanden. Auch wenn die staged Apps alte `last_seen_at`-Einträge aktualisiert haben, kann kein Eintrag daraus als DO-WSS-Gerätepräsenz in ChatGPT ausgegeben werden.

## Verbindliche Übergabe an Connector

[**RC71 LIVE GO Owner-/Device-Admission-Blocker – Connector Issue #56**](https://github.com/NMKato/KatoSync-Remote-MCP/issues/56).

Bereits bestehende Quellen: Connector [RC66 Owner Consent Draft #43](https://github.com/NMKato/KatoSync-Remote-MCP/pull/43) (nur Plan, `mutationPerformed:false`) und [RC70 Signed Relay/Authority Draft #55](https://github.com/NMKato/KatoSync-Remote-MCP/pull/55) (nur synthetische private Zulassungsreader). Nicht nochmals als parallele Architektur implementieren.

**Reihenfolge:**

1. Owner-authentifizierte, aktuelle KatoOS-Session und **separates MFA-Step-up** für explizite `manual` Owner-Opt-in-/Client-/Device-Aktionen. Keine direkte SQL-Seed-Freigabe und keine vom Modell oder von einem Relay-Frame vorgegebene Zustimmung.
2. Registrierte, nicht widerrufene lokale Geräteschlüssel eindeutig serverseitig prüfen; nur mit expliziter Zustimmung Enrollment `discovered` → `trusted` bzw. geeigneten verifizierten Trust-State fortschreiben, mit Audit, Revocation, RLS und CAS.
3. Owner-signierter/step-up-gebundener, zeitlich begrenzter ClientGrant (max. 30 Tage) und GeräteConsent (max. 7 Tage) mit `devices.list`/`device.status` und auf exact device-id gebunden. **Berechtigungen unabhängig voneinander prüfen.**
4. Den bestehenden RC31-/RC5-/RC70-Authority-Reader mit tatsächlichem KatoOS-Owner/Client/Device/Consent verbinden. Server-Ed25519-Pin/Rotation und one-use Ticketdienste persistent und vertrauenswürdig implementieren, erst danach den privaten Cloudflare-DO-WSS-Endpunkt autorisiert bereitstellen.
5. Ersten physischen M2/M3-Test mit **bestehender KatoOS-QA-Keychain-Identität** (kein `ensure_identity`) durchführen: signierte Challenge, signierte Device-Präsenz, serverseitiger ACK, Ablauf/Revoke/Replay/Owner-Wechsel. Erst danach die echten read-only ChatGPT-Tools sichtbar machen und den RC73-Build kontrolliert installieren.
6. [Sicherheitsblocker picomatch #282](https://github.com/NMKato/KatoSync/issues/282) unverändert bis zur sicheren Behebung bewahren. Keine Audit-Umgehung.

**Heutiger MCP-Live-Befund:** `authenticated_synthetic_qa`, `meshConnected=false`, `deviceAccessEnabled=false`.

**Beta-Entscheidung:** Native RC73 PASS, tatsächliche Geräteanbindung **NO-GO**. Keine produktiven Rechte, Tabellen oder Anwendungen wurden geändert. Dieses Dokument ist ein Diagnose- und Übergabeprotokoll, **keine Owner-Einwilligung**.
