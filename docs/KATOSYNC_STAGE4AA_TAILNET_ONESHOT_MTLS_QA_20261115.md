# Stage4AA – Isolierter Tailnet-mTLS-Hardwaretest

**Tracking:** #267; auf Stage4Z / Draft-PR #263 aufgebaut. Kein Main-Merge/Deployment.
Das vorhandene Stage4W-LAN-QA bleibt unverändert: gleiche private RFC1918-/24-Adressen.
Die Macs sind auf verschiedenen physischen Netzen; ihre gleichen lokalen Subnetze
sind nicht gegenseitig routbar. Beide Geräte haben ein gemeinsames, bereits
autorisiertes Tailscale-Konto.

## Sicherheitsgrenze

- Stage4AA ist **kein** permanenter Mesh-Tunnel und **kein** Geräte-Commander.
- Nur eigener CLI-Einstieg im isolierten `stage4j-qa`-Build.
- Zwei QA-Opt-ins: `KATOSYNC_STAGE4W_LAN_QA_ONCE=OWNER_LAUNCHED_QA_ONLY` und
  `KATOSYNC_STAGE4AA_TAILNET_QA_ONCE=OWNER_LAUNCHED_TAILNET_QA_ONLY`.
- Der feste, nicht durch Benutzerparameter ersetzbare Tailscale-Mac-Client
  wird ohne Shell mit begrenztem Zeitfenster nur für `status --json` aufgerufen.
- Erlaubt wird **nur** das aktuelle Self-Tailnet-IPv4 und exakt ein als
  online registrierter Peer mit demselben nichtleeren Tailscale-UserID;
  keine andere CGNAT-/Public-/Loopback-/Wildcard-Adresse, kein fremder Peer.
  Snapshot-Prüfung vor und nach Zulassung und vor/nach mTLS.
- TCP-Listener nur an die geprüfte lokale Tailscale-Adresse, eine
  Verbindung mit exakt erwarteter Quell-IP. Client bindet die Quell-IP
  explizit über TcpSocket. Port >1024, Timeout und begrenzter Public-DER-Prelude.
- Unabhängig vom Tailnet sind die **bereits vorhandene** online verifizierte
  KatoOS-Owner-Sitzung, lokale Ed25519-Keychain-Identität, zuvor
  gegenseitig freigegebene Peer-Pins sowie beide nicht widerrufenen
  Enrollment-Zeilen vor/nach TLS verbindlich.
- Kein Keychain-Schreiben, kein neues Pairing, keine Shell/Datei/Remote-Job
  API, keine Hintergrundleistung, kein neues Web-IPC, kein offener Dauerkanal.

## Ablauf und Abnahme-Gates

1. Native CI, Rust-Unit- und Node-Vertragstests inkl. Negativfällen grün.
2. Eigenes SHA-256-verifiziertes, Developer-ID-signiertes/notarisiertes
   Stage4AA-QA-App-Bundle auf M2 und M3, keine Überschreibung von Stage4Z.
3. Nur nach explizitem Owner-QA-Opt-in auf beiden Macs:
   `--stage4aa-tailnet-qa-once listen|connect LOCAL_OVERLAY_IP PEER_OVERLAY_IP PORT PUBLIC_FINGERPRINT`.
   Server zuerst, Client danach, jeweils nur ein Lauf. Niemals echte
   private Schlüssel oder Session-Tokens in CLI-Parameter aufnehmen.
4. Positiver gegenseitiger TLS-Proof muss auf **beiden** Endpunkten
   `MESH_STAGE4AA_PINNED_MTLS_ONCE_PASS_NO_REMOTE` und Exit 0 liefern.
   Kanal ist danach geschlossen. Zusätzlich Negativtests ohne Opt-in,
   falschen/gesperrten Peer oder Offline-Tailnet dokumentieren.
5. Keine Produktion, keine Remote-Rechte bis zu eigenständiger Release-Abnahme
   für Heartbeat, Widerruf, Reconnect und MCP-Rollen.

`Tailscale ping` allein ist **kein** KatoSync-mTLS-Nachweis.
