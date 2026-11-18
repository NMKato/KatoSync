# KatoSync Hybrid Mesh – Stage 2C: echter M2↔M3 LAN-Probe

Stand 28.10.2026 – **Hardware-QA erfolgreich**, kein produktives Geräte-Pairing.

## Architektur und Vertrauensgrenzen

Die produktionsferne, explizit ignorierte Rust-Integrationstestfunktion
`manual_two_host_private_lan_pinned_tls_probe` in
`src-tauri/src/mesh_transport.rs` ruft die bereits getrennten
`client_probe`- und `server_probe`-Services auf. Weder UI, ViewModel noch
Tauri-IPC, KATOOS-Authentifizierung, Supabase-DB oder Keychain werden geändert.

Nur per manueller Freigabe `KATOSYNC_MESH_LAN_QA_ALLOW=SYNTHETIC_FIXTURES_ONLY`
startet der Test. Rollen: `server`, `client`, `client-wrong-pin`. Die
Endpoint-Policy akzeptiert nur private RFC1918-IPv4-Ziel-/Quelladressen mit
nicht privilegiertem Port; der Server bindet genau eine angegebene
LAN-Schnittstelle, akzeptiert genau **eine** Verbindung und bricht nach
spätestens 45 Sekunden ohne Verbindung ab. Erwartete Peer-IP ist explizit
festgelegt und vor dem mTLS-Probe zu prüfen.

Wichtig: Beide Testgeräte verwenden ausschließlich **bekannte, synthetische**
Ed25519-Fixture-Schlüssel. Diese Schlüssel sind für echte Geräte **nicht
geheim** und dürfen **niemals** für produktive Gerätezulassung benutzt werden.
Der Netzwerk-Test validiert die Programmfunktion, keine reale Konto-/Geräte-
Eigentümerschaft.

## Tatsächlich geprüfte Hardwareläufe

- M2 und M3 online über den separaten Remote Desktop Commander.
- Gleiche QA-Test-Executable auf beiden Rechnern; SHA-256 bytegleich und
  macOS-Ad-hoc-Codesign verifiziert. Keine bestehende KatoSync-App ersetzt.
- **Positiv:** M2 einmaliger Rust-TCP-Listener, M3 Rust-Client im gleichen
  privaten LAN. Beide Prozesse: `1 passed; 0 failed`. Tatsächliches
  gegenseitiges TLS 1.3 mit gepinntem Ed25519-Zertifikat und bestätigtem
  noncegebundenem 40-Byte-Probe-Frame.
- **Negativ:** M3 mit absichtlich falschem Ed25519-Pin. Client und Server
  bestätigen beide die abgewiesene, nicht authentifizierte Probe
  (`1 passed; 0 failed` pro Gerät).
- Ein initialer Testlauf deckte eine zu pauschale QA-Adressprüfung auf:
  Server-Eigenadresse und erwartete Client-IP müssen **verschieden** sein,
  Client-Zieladresse und erwartete Server-IP müssen **gleich** sein. Behoben
  und über separate reine Testlogik mit Regressionen abgesichert.
- Nach dem Transfer wurde der nur temporäre HTTP-Dateiserver gestoppt und
  seine Dateiablage gelöscht; die eigentlichen TCP-Probe-Listener sind
  beendet. Keine dauerhafte Serverkomponente, kein Cloud-Relay oder
  laufender Mesh-Daemon wurde gestartet.

## Regression und Codequalität

- Vollständige native Rust-Suite mit `katoos-auth-qa`: **210 bestanden,
  0 fehlgeschlagen, 8 übersprungen** (einschließlich bewusst manueller LAN-QA).
- Für die manuelle QA sind Rollen, Netzadressen und Testfreigabe erforderlich.
  Der reine Policy-Test läuft ohne Netzwerk und prüft positive und negative
  Rollen-/Netz-/Portkombinationen.
- Der UI-Mesh-Status darf weiterhin NICHT auf `connected` wechseln:
  `verifiedPeers=0`, `remoteReadOnlyDispatch=false`,
  `crossDeviceWrites=false`.
- Alle produktiven Rust-Mesh-Komponenten bleiben getrennt:
  `mesh_identity`, `mesh_handshake`, `mesh_trust`, `mesh_tls`,
  `mesh_transport`, `mesh_readiness`.

## Nächste Roadmap-Gates

1. Beide tatsächlichen Geräte mit derselben online verifizierten
   KATOOS-Konto-ID registrieren – serverseitiger Challenge-Besitznachweis,
   Quotas, RLS und Single-use-Replay-Schutz, zunächst nur in isolierter QA.
2. Auf **beiden** Geräten signierte Challenge/Response austauschen,
   Vergleichscode explizit bestätigen und die echten Ed25519-Public-Key-Pins
   sicher persistieren. Bloßes gemeinsames Konto reicht nicht aus.
3. Gegen die gespeicherten echten Pins einen begrenzten TLS-Verbindungsaufbau
   versuchen; Widerruf und Konto-Wechsel müssen auch **laufende** Sessions
   beenden. Danach kontrollierte Heartbeats/Reconnect.
4. Erst darauf aufbauend: eine auf geprüfte Rechte begrenzte Read-only-Job-
   Nachricht mit ID, Ablauf, Replay-Schutz und Receipt. Remote-Writer
   bleiben bis zu Lease/Fencing/Human Approval gesperrt.

Kein Produktiv-Deployment, keine Freigabe für Fernsteuerung, keine echten
Geräte-IDs, IP-Adressen, Private Keys oder Nutzerkonten in dieser Dokumentation.
