# Stage4AB.2 – Begrenzter, echter mTLS-Kanal mit authentifizierten In-Channel-Heartbeats

**Projekt:** NMKato/KatoSync – Parent PR #270, Roadmap Issue #269.
**Branch:** qa/stage4ab2-pinned-heartbeat-supervisor-20261116.
**Status:** Ausschließlich isolierte stage4j-qa-Entwicklung, kein produktiver Dauerkanal.

## Ausgangspunkt

Stage4AA hat am 15.11.2026 beidseitig gepinntes TLS 1.3 über M2/M3
und Tailscale an zwei getrennten Standorten in beiden Rollenrichtungen
bestanden. Stage4AB.1 hat einen passiven, monotonen, fail-closed
Lease-Zustandsautomaten mit Rust-Tests nachgewiesen.

## Isolierte Stage4AB.2 – beaufsichtigte QA-Verbindung

Ein eigener CLI-Einstieg --stage4ab2-live-qa-once erfordert drei
unabhängige, ausdrücklich autorisierte QA-Opt-ins:
- KATOSYNC_STAGE4W_LAN_QA_ONCE=OWNER_LAUNCHED_QA_ONLY
- KATOSYNC_STAGE4AA_TAILNET_QA_ONCE=OWNER_LAUNCHED_TAILNET_QA_ONLY
- KATOSYNC_STAGE4AB2_LIVE_QA_ONCE=OWNER_LAUNCHED_LIVE_QA_ONLY

Es gelten weiterhin die vom Tailscale-Daemon selbst bestätigte
genaue Peer- und Local-IPv4, gleicher Tailscale-User, korrekte
Netzwerkquelladresse und SingleQaPermit. Keine öffentliche
Wildcard-Bindung, keine Router-Portweiterleitung.

Vor dem mTLS-Handshake werden die existierende KatoOS-Owner-Sitzung,
die originale Ed25519-Keychain-Identität, der gegenseitige, explizit
genehmigte Public-Key-Pin und die beiden owner-scoped Enrollment-
Datensätze inklusive Revocation geprüft. Während jeder Heartbeat-
Runde erfolgt die erneute Sitzung-/Keychain-/Enrollment-Abfrage.

Nach dem strikt gepinnten TLS-1.3-Handshake wird aus frischen
Client- und Server-Nonces ein neuer Session-Binding-Wert abgeleitet.
Ausschließlich starre KSM2PING- und KSM2PONG-Frames mit korrekter
Nonce und steigender 64-Bit-Sequenz sind erlaubt. Keine dynamischen
Payloads, Geräteshells, Filesystem-, Browser- oder MCP-Rechte.

Die interne Stage4AB.1-Lease wird nur bei vorhandener, wirklich
offener TLS-Sitzung und korrektem In-Channel-Heartbeat erneuert.
25 Sekunden Heartbeat-TTL und 300 Sekunden absolute Maximaldauer
bleiben unverändert. Dieser konkrete QA-Test ist zusätzlich auf
drei Heartbeat-Runden, 5-Sekunden-Intervalle und maximal 100 Sekunden
Gesamtlaufzeit begrenzt. Nach Abschluss wird die TLS-Sitzung explizit
geschlossen. Ein erfolgreiches Receipt beweist lediglich historische
drei In-Channel-Heartbeats, keine weiterhin aktive Verbindung.

## Abnahmeplan

1. Rust-/Node-Negativtests (falsche Nonce, Sequenz/ACK, unbekannter
   Peer, Owner- und Keychain-Revoke, Ablauf, fehlende QA-Opt-ins) sowie
   native macOS-CI vor Signierung.
2. Isolierter QA-App-Build aus exakt demselben geprüften Git-Commit,
   Developer-ID-Signatur, Apple-Notarisierung und SHA-256-Abgleich auf
   M2 und M3. Bestehende Stage4AA-Apps nicht überschreiben.
3. Positive M2/M3-Tests in beiden Rollen über Tailscale, danach
   negative Offline-/Keychain-/Enrollment-Tests und Sleep/Wake.
4. Kein Main-Merge, kein Produktiv-Rollout oder dauerhafter Listener
   ohne gesonderten Security-Review. Persistenter, automatischer
   Reconnect und UI-Liveness gehören in Stage4AB.3, MCP-Datenzugriff
   in ein eigenes RC65-Consent-/Audit-Gate.
