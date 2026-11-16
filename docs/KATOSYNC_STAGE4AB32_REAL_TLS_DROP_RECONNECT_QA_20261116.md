# Stage 4AB.3.2A – Realer TLS-Kanalabbruch und einmalige Neuauthentifizierung

**Projekt:** NMKato/KatoSync. Ausgangsbasis: Stage4AB.3.1 Draft-PR #274.
**Branch:** qa/stage4ab32-controlled-drop-reconnect-20261116
**Status:** QA-only. Keine produktive Verbindung, keine neuen Gerätebefugnisse.

## Tatsächlicher, begrenzter Fault-Test

Ein neuer, ausschließlich über das bestehende Rust-Feature stage4j-qa
kompilierter CLI-Modus:

    --stage4ab32-drop-reconnect-qa-once listen|connect localTailnetIP peerTailnetIP port peerFingerprint

Er verlangt ZUSÄTZLICH zu den vier bestehenden expliziten
QA-Owner-Opt-ins das fünfte Opt-in:

    KATOSYNC_STAGE4AB32_DROP_RECONNECT_QA_ONCE=OWNER_LAUNCHED_DROP_RECONNECT_QA_ONLY

Beide Macs halten während ihres einzelnen QA-Laufs ein exklusives
SingleQaPermit. Vor dem Handshake sind wie zuvor die echte
KatoOS-Owner-Session, die originale Ed25519-Keychain-Identität,
der akzeptierte Peer-Public-Key-Fingerprint und beide owner-scoped
Enrollment-/Revocation-Datensätze sowie die genauen Online-Tailnet-
Adressen zu überprüfen.

Der Server lässt einen ECHTEN, gegenseitig signaturgeprüften
TLS1.3-Kanal den ersten In-Channel-Heartbeat (mit Session-Nonce,
Sequence und erneuter Owner-/Enrollment-Prüfung) bestehen.
Er invalidiert daraufhin seine Live-Lease und lässt den realen
TLS-/TCP-Kanal durch Scope-Drop schließen. Clientseitig darf
nur ein tatsächlich beobachteter TLS-I/O-Abbruch beim nächsten
Heartbeat als kontrollierter Fault gelten.

Weder ein erfolgreicher Heartbeat Nr. 2 noch TLS-Timeout, schlechte
Pins, Revoke, Netzdatenfehler oder sonstige Probleme dürfen eine
erneute Verbindung autorisieren.

Nur nach dem erwarteten, tatsächlich beobachteten Stream-Abbruch
wird ein begrenzter Abstand (Server 2s / Client 5s) durchlaufen.
Danach erfolgt GENAU EINE komplett neue TLS-1.3-Sitzung mit
frischem Zufalls-Nonce, erneuten KatoOS-/Keychain-/beidseitigen
Enrollment-/Tailnet-Prüfungen und drei echten In-Channel-Heartbeats.
Jeder Fehler bei dieser zweiten Sitzung ist terminal. Absolute
Obergrenze 175s.

## Sicherungsgrenzen

- KEIN echter Wi-Fi-/OS-Netzwerkadapter wird getrennt.
- KEINE realen Keychain-Fingerprints oder Supabase-Geräte-Records
  werden mutiert oder widerrufen. Die bestehenden Revocation- und
  Sleep/Wake-Negativmodelle bleiben separat testbar.
- KEIN Dauerdaemon, Produktions-Backoff, Hintergrund-Auto-Reconnect,
  Tauri-Web-IPC, Remote-Job oder remote Dateizugriff.
- Der positive Teststatus beschreibt ausschließlich die HISTORISCH
  erfolgreich beendete einmalige QA-Sequenz, niemals eine aktuell
  offene Geräteverbindung.

## Abnahmekriterien

1. Native Rust-Testfälle für Negativfehler + Node-Codevertrag,
   alle bisherigen Stage4Y–AB3.1-Regressionen, exakter CI-Commit.
2. Identisches signiertes ARM64-Executable auf M2 und M3, gültige
   Apple Developer ID, Notary/Stapple/Gatekeeper.
3. Beidseitiger Hardwaretest: erster authentifizierter TLS-Kanal
   wird real abgebrochen; nur dann neuer gepinnter Handshake mit
   drei authentifizierten Heartbeats und Exit 0.
4. Negative Gates (fehlendes fünftes Opt-in, ungenehmigter Pin);
   anschließend keine Listener, Prozesse, etablierten Sessions.
5. Separates, noch OFFENES Stage4AB.3.2B für Live-Revoke/
   Hardware-Sleep/Wake/physische Netzwerkänderungen und echte
   dauerhafte Supervisorschleife samt Security Review.

PR bleibt Draft. Kein Merge nach main oder Produktiv-Deploy.
