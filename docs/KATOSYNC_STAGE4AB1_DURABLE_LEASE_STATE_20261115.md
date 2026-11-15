# Stage4AB.1 – Interner Mesh-Zustandsautomat und begrenzte Heartbeat-Lease

**Projekt:** NMKato/KatoSync | Tracking #269 | Parent-Draft-PR #268.
**Status:** QA-Entwicklung, kein Produktiv- oder Hardware-Release.

## Ausgangspunkt

Stage4AA hat am 15.11.2026 die gegenseitig mit realen Ed25519-
Geräteidentitäten gepinnte TLS-1.3-Authentifizierung auf M2/M3 in
beiden Rollen erfolgreich nachgewiesen. Die Einmal-Verbindung
schloss anschließend beide Sockets. **Kein dauerhafter Tunnel.**

Bestehende Device-Presence-Heartbeats sind signierte Statusmeldungen,
**kein** Nachweis einer aktuell offenen Peer-TLS-Sitzung. Ebenso kann
ein erfolgreiches `Tailscale ping`, ein Directory-Roster,
`locally_paired` oder Stage4AA-Einmal-PASS keine `connected_authenticated`
Anzeige legitimieren.

## Neue passive Stage4AB.1-Komponente

`src-tauri/src/mesh_durable_lease_qa.rs` enthält einen ausschließlich
internen, testbaren **monotonen** Zustandsautomaten:

- `not_paired`, `locally_paired`, `verifying`,
  `connected_authenticated`, `reconnecting`, `unreachable`,
  `revoked`.
- Positive Authentifizierung benötigt ein internes, versiegeltes
  `ValidatedOpenTlsSocket`-Ereignis einer **noch offenen** TLS-1.3-
  Sitzung. **In Stage4AB.1 gibt es absichtlich keinen Runtime-Producer**
  für dieses Ereignis – erst Stage4AB.2 darf nach Review einen echten,
  revalidierten Socket damit verbinden.
- Ein Heartbeat darf die Authentifizierung nur mit einem weiteren
  internen, versiegelten `VerifiedInChannelHeartbeat` fortsetzen:
  gleiche Owner-ID, lokale/entfernte Ed25519-Identität,
  TLS-Sitzungsnonce, streng steigende Sequenznummer, monotone Zeit.
- Lease = 25 Sekunden, absolute Session-Obergrenze = 5 Minuten,
  unabhängig von Heartbeat-Verlängerungen. Fehlende oder verspätete
  Heartbeats entfernen die Authentifizierung **auch bei ausbleibendem
  UI-Tick** (Snapshot wertet die Deadline selbst aus).
- Kontowechsel/Widerruf => unverzüglich `revoked` ohne stilles
  Re-Pairing. Socket-Ende/Netzunterbrechung => `reconnecting`,
  Sleep/Wake => `unreachable`, niemals weiter „online“.
- Der Zustand verleiht niemals Remote-CLI, Dateien, Desktopkontrolle,
  read-only MCP-Dispatch oder Cross-Device-Writes.

## Explizit *nicht* aktiviert

Noch **keine** Hintergrundprozesse, Wiederverbindungsversuche,
Tauri-Web-IPC, neue HTTP-/TCP-Listener, neue Identitäten/Keychain-Einträge,
DB-Schreiboperationen, neue Cloud-Token, QA-App-Signierung
oder Produktionsbereitstellung. Das Modul wird nur mit dem
isolierten `stage4j-qa`-Feature kompiliert.

Die späteren Gates bleiben getrennt:

- **AB.2:** supervisor über echten offenen mTLS-Kanal, signierte
  Heartbeats, tatsächliche Readiness, Revalidation und Reconnect.
- **AB.3:** signierte Apple-QA-App und echte negative/positive
  Hardwareproben (Revoke, Sleep/Wake, Netzwechsel, Ownerwechsel).
- **AB.4 / RC65:** ausschließlich nach gesonderter Freigabe lesender
  MCP-Gerätestatus; Fernbefehle benötigen ein zusätzliches
  bereichsbeschränktes Consent-/Audit-Gate.

## Tests

Native Rust-Unit-Tests decken TTL-Ablauf und absolute Lebensdauer,
Replay, falsches Owner-/Peer-Binding, ungültiges Proof-Material,
Socket-Ende, Netzausfall, Sleep/Wake, Widerruf sowie fehlende
Jobrechte ab. Node-Vertragstests stellen sicher, dass dieses Modul
keine Web-/CLI-Oberfläche, Netzwerk-/Datei-API oder Produktionsroute
hinzufügt. Native macOS CI erforderlich, **vor** jedem Hardwareversuch.
