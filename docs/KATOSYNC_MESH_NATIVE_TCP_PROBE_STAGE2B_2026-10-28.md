# KatoSync Hybrid Mesh – Stage 2B: verifizierter TCP/mTLS-Probe-Kern

Stand: 28.10.2026. Isolierter Entwicklungsbranch; **nicht produktiv verbunden**.

## Zuständigkeitsgrenzen

| Baustein | Aufgabe | Kein Recht auf |
| --- | --- | --- |
| `mesh_identity.rs` | gerätegebundene Ed25519-Identität im OS-Keychain | automatische Kopplung |
| `mesh_handshake.rs` | signierte gegenseitige Challenge/Response | Fernaufträge |
| `mesh_trust.rs` | explizit bestätigte, widerrufbare Public-Key-Pins | Netzwerkstatus |
| `mesh_tls.rs` | mTLS-Konfiguration mit exakt gepinntem Peer-Zertifikat | Listener/Discovery |
| `mesh_transport.rs` | einmaliger TLS-1.3-Probe über **realen TCP-Stream** | dauerhaftes Pairing, Commands, Remote-Writer |
| `mesh_readiness.rs` | ausschließlich wahrheitsgemäße UI-Statusgrundlage | Vertrauensstufen aus Testdaten ableiten |

## Umgesetzt

- Native Dienstfunktionen `client_probe` und `server_probe`. Ein aufrufender Service muss bereits einen TCP-Socket, eigene Geräteidentität und explizit lokal bestätigten Public-Key samt geprüftem Zertifikat besitzen. **Kein** Tauri-IPC-Befehl, automatischer LAN-Listener, Cloud-Relay, Port-Scan, Gerätesuche, Remote-Job, Persistenz oder stiller Reconnect.
- Vor Annahme des Probe-Protokolls besteht gegenseitige rustls-Authentifizierung (TLS 1.3, ausschließlich AES-256-GCM und X25519) anhand des lokal bestätigten Ed25519-Pins.
- Feste Frames mit je 40 Bytes und einmaligem, frischem 32-Byte-Nonce (OS-Zufall), Antworten müssen das Nonce exakt zurückliefern. Weder untrusted JSON noch unbeschränkte Längen werden eingelesen.
- Feste Frist von 4 Sekunden für TLS und Applikationsprobe; keine Klartext- oder sonstige Fallback-Verbindung.
- Konfigurations- und Framefehler werden als feste Statuscodes zurückgegeben; keine Secrets oder Peer-Zertifikate werden geloggt.
- Ein erfolgreicher TCP-Probe bleibt **flüchtig**. Die UI-Bereitschaft muss bei `not_connected`, null Peer-Verbindungen und gesperrten Fernaufträgen bleiben, bis die echte, durchgehende Sitzungsarchitektur separat freigegeben ist.

## Testabnahme

Synthetische Test-Ed25519-Schlüssel, echtes IPv4-Loopback-TCP und `tokio-rustls`; keine Veränderung an realen Geräte-Keys. Testfälle: beidseitig akzeptierte mTLS-Verbindung, abgelehnter falscher/revokter Peer-Pin, ungültiges Applikations-Frame, falsch zurückgegebenes Nonce und schweigendes Gegenüber mit Timeout. Der früher vorhandene In-Memory-Duplex-Test bleibt unabhängig.

## Bis zu M2↔M3 weiterhin erforderlich

1. Echtes Geräte-Enrolment (serverseitige Eigentümerprüfung), sichere Zustellung und expliziter **beidseitiger** SAS-Schlüsselvergleich mit aktueller Revocation.
2. Erst danach kontrollierter, an den verifizierten Account gebundener Listener und eine auf konkrete Geräte beschränkte LAN-Verbindung – mit Authentifizierungsprüfung auf jedem neuen Socket.
3. Active-session-Tracking, Widerruf beendet **bestehende** Sessions, Sleep/Wake, Backoff, Heartbeat-Ablauf, Replay-Fenster, verbindliche Gerätegrenzen.
4. Erst anschließend ein separat autorisierter Read-only-Git-Metadatenauftrag mit Job-ID und überprüftem Ergebnis. Keine Remote-Writes, bevor Lease/Fencing für parallele Geräte geprüft sind.

**Hinweis:** Ein TCP-Probe auf einem Gerät beweist nicht die Funktionsfähigkeit des M2↔M3-Mesh. Der Mehrgeräte- und UI-Livetest ist ein eigener Gate.
