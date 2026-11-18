# KatoSync Mesh Stufe 2A – strict TLS 1.3 / AES-256 mTLS crypto core

Stand: 26. Oktober 2026. Draft-Branch `feat/mesh-strict-mutual-tls-core-20261026`.

## Verifiziert implementiert
- Rust-Modul `src-tauri/src/mesh_tls.rs` baut strict TLS-1.3-Client- und Serverkonfiguration mit `rustls` (Ring); ausschließlich AES-256-GCM-SHA384 sowie X25519 als klassischer ephemerer Schlüsselaustausch. TLS1.2 und unverschlüsselter Fallback werden nicht unterstützt.
- Der Gerätezertifikats-Entwurf wird aus dem bestehenden Ed25519-Geräteschlüssel abgeleitet, der per KatoSync-Login aus dem OS-Schlüsselbund geladen werden kann. X.509-Zertifikate enthalten keine privaten Kontodaten. Die lokalen Testschlüssel sind ausschließlich synthetisch.
- **Beide Gegenstellen** müssen ein überprüftes Zertifikat vorlegen. Zulässige Trust Anchors werden ausschließlich aus dem *explizit lokal bestätigten* Stage-1C-Peer-Public-Key und exakt dazu passendem Ed25519-Zertifikat erstellt. Falsches Gerät, manipulierte Fingerprints, unbestätigtes Gegenüber und ungültige Zertifikate werden abgelehnt.
- Die Konfiguration verbietet 0-RTT-Clientdaten; kein Zertifikat-wird-immer-akzeptiert-Callback, kein Server ohne Clientzertifikat.
- Der verschlüsselte TLS-Test wird mit `tokio::io::duplex` innerhalb des Rust-Testprozesses durchgeführt, ohne offene Ports, externe Geräte oder Netzwerkübertragungen. Positive PING/PONG-Nachricht sowie falsche Peer-Pins, fehlerhafte Zertifikate und ungültige Metadaten getestet.
- Ein initialer nativer App-Build ist Bestandteil der PR-Abnahme, wird aber nicht als vollständiger Mehrgeräte-Test ausgegeben.

## Was NICHT freigegeben ist
- Bisher **kein** echtes M2↔M3 Pairing/Transport, kein Listener, keine LAN-Discovery, kein Relay, kein Auto-Reconnect, keine Fernaufträge und keine autonomen Writes. Die schon vorhandene Bereitschafts-UI bleibt auf `not_connected` und 0 aktive Mesh-Peers, unabhängig von lokal bestätigten Zertifikats-Pins.
- Eine E2E-Verbindung benötigt zusätzlich echte beidseitige KatoSync-Anmeldung, Stage-1B/1C-Codebestätigung auf beiden Geräten, dauerhaftes Pin-/Widerrufs-Management und sauberen Timeout/Socket-/Frame-Limit-/Replay-Schutz, erst danach Read-only Job mit korrelierter Quittung.
- Der aktuelle X25519-Austausch ist **noch nicht post-quantum**. X25519MLKEM768 ist eine spätere, separat gegen Bibliotheks- und Interoperabilitäts-/Downgrade-Risiken zu prüfende Stufe. Keine selbst entwickelte Kryptografie.
- Die langfristige Ed25519-Identität ist noch klassisch, nicht PQ-Signatur; Migration/Rotation ist eigenes Gate.
- macOS-Ad-hoc-Beta-Signatur, Keychain-Friktion und Windows-Credential-Store bleiben getrennte Release-Gates (#129), sichere Agenten-Writer-Freigabe durch #76 nicht ersetzt.

## Nächste verbindliche Reihenfolge
1. Abgesicherte Verteilung isolierter M2-Beta auf M3 und dortige Anmeldung ohne bestehende Arbeitsprojekte zu überschreiben.
2. Auf echten Geräten Stage-1C Peer-Zertifikate und Ed25519-Pins vollständig auf Kontobindung prüfen, dann mTLS über direkten LAN-Port (nur nach explizitem Pairing); falsche Geräte und Widerruf E2E testen.
3. Reconnect/Backoff/Sleep/Wake, laufende Sitzungen bei Widerruf sofort trennen, persistente Trust-Store-Änderungen sicher serialisieren. Anschließend verschlüsselten, leerlaufbegrenzten Read-only-Git-Metadaten-Auftrag mit Job-ID/Receipt.
4. Später verschlüsselter Relay-Fallback für Reisen und optional hybrider Post-Quantum-Handshake. Keine unkontrollierten Cloudkosten, kein Pairing nach bloßem RDC-Online-Status.

Nur Quellcode, synthetische Testidentitäten und allgemeine QA-Aussagen ins öffentliche Repo; keine IPs, Tokens, Passwörter oder echten Peer-Zertifikate.
