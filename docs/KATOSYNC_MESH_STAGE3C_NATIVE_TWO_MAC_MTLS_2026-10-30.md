# Stage 3C – Echter nativer Rust-mTLS-Verbindungstest über zwei Macs

**30. Oktober 2026** · [Stage 3B / Draft-PR #194](https://github.com/NMKato/KatoSync/pull/194) als Ausgangspunkt. Getestet auf einem physischen M2 und M3 im privaten LAN. **Dies ist keine produktive Geräte-Kopplung.** Kein Supabase-Cloud-Zugriff, keine Kontoanmeldung, keine Schreiboperationen im produktiven macOS-Schlüsselbund, kein automatisches Trust-Onboarding und kein Remote-Job.

## Ursprung und technische Architektur

Der vorhandene, bislang **ignorierte** native Rust-Test `mesh_transport::tests::manual_two_host_private_lan_pinned_tls_probe` wurde erstmals wirklich auf **zwei verschiedenen Rechnern** ausgeführt:

- **M2:** Rust-Server `192.168.178.97:39400`, erwartet ausschließlich Client-IP `192.168.178.165`.
- **M3:** Rust-Client gegen `192.168.178.97:39400`, mit exakter Server-IP-Bindung.
- Beide Seiten benutzen die vorhandenen `DeviceTlsIdentity`, `strict_client_config`, `strict_server_config`, `client_probe` und `server_probe` aus **dem KatoSync Rust-Kern**. Zertifikate stammen nur von den synthetischen Test-Ed25519-Schlüsseln (`signing(41)` und `signing(42)`); der produktive App-Keychain wird nicht berührt.
- Der Kern beschränkt das Protokoll auf TLS 1.3 und mTLS mit Ed25519-Zertifikatspins, X25519 und AES-256-GCM; der Test sendet ausschließlich ein festes 40-Byte-Hello mit frischem Nonce und erwartet die korrekte 40-Byte-Antwort. Keine Tauri-IPC-Kommandos, kein automatischer Listener oder persistente Verbindung.
- Netzwerkfreigabe ist ausschließlich ein vom Benutzer bewusst gestarteter, einmaliger Test auf RFC1918-LAN-Adressen und einem unprivilegierten Test-Port. Der native Test besitzt einen 45-Sekunden-Accept- und viersekündigen Probe-Timeout.

## Tatsächliche QA-Läufe und Resultate

1. **Erster Versuch – kein kryptografischer Fehler:** M2-Server war bereits nach 45 Sekunden geschlossen, während der M3 die Rust-Binärdatei noch erstmalig baute. Der verspätete Client sah `Connection refused`. Ein anfänglich zu strenger Quellen-Suchausdruck im neuen Launcher wurde zusätzlich korrigiert.
2. **Positiv (nach Warm-Build):** M2-Server **1/1 Rust Hardwaretest bestanden**; M3-Client **1/1 bestanden**. Tatsächlicher gegenseitig authentifizierter TLS-Kanal, Nonce-Echo korrekt.
3. **Negativ, falscher Peer-Pin:** Der M3 nutzte absichtlich einen nicht zum M2-Zertifikat passenden synthetischen Public-Key-Pin. **M2-Server 1/1 bestanden und M3-Client 1/1 bestanden**, weil die Verbindung erwartungsgemäß **nicht authentifiziert** wurde. Das negative Ergebnis beruht auf einer wirklich aufgebauten und abgewiesenen TCP-Verbindung, nicht nur auf statischer Quelltextanalyse.
4. **Zusätzliche Testhärtung:** Der native Client verlangt für den falschen Pin nun den **genauen Fehler** `TLS-Zertifikat gehört nicht zur freigegebenen Geräteidentität.` statt irgendeines Netzwerkfehlers. Der Hardwaretest verifiziert nach jeder Variante zusätzlich `verifiedPeers == 0`, `remoteReadOnlyDispatch == false` und `crossDeviceWrites == false`. Diese ergänzte Version muss ebenfalls in der erneuten Hardware-Gegenprobe bestehen.
5. Neuer beidseitig wiederverwendbarer Teststarter `scripts/qa-mesh-native-two-host.sh`: explizite `SYNTHETIC_FIXTURES_ONLY`-Freigabe, Rollenprüfung, keine echten Secret-/Zertifikatsparameter, keine externen Server, nur der bereits ignorierte Rust-Test mit `cargo test --offline`, `--exact` und `--test-threads=1`. Vier reguläre plattformübergreifende Node-Tests prüfen den Default-Deny- und Non-Trust-Vertrag.

## Wiederholung: ohne produktive Schlüsselbund- oder Supabase-Zugriffe

Auf **M2** als Server (Test-only-Ressourcen-Stub und vorheriges `npm run build` müssen vorliegen):

```bash
KATOSYNC_MESH_LAN_QA_ALLOW=SYNTHETIC_FIXTURES_ONLY \
KATOSYNC_MESH_LAN_QA_ROLE=server \
KATOSYNC_MESH_LAN_QA_ADDRESS=192.168.178.97:39400 \
KATOSYNC_MESH_LAN_QA_EXPECT_PEER=192.168.178.165 \
CARGO_TARGET_DIR=/ABSOLUTER/PFAD/ZUM/LOKALEN/TARGET \
bash scripts/qa-mesh-native-two-host.sh
```

Auf **M3** als Client:

```bash
KATOSYNC_MESH_LAN_QA_ALLOW=SYNTHETIC_FIXTURES_ONLY \
KATOSYNC_MESH_LAN_QA_ROLE=client \
KATOSYNC_MESH_LAN_QA_ADDRESS=192.168.178.97:39400 \
KATOSYNC_MESH_LAN_QA_EXPECT_PEER=192.168.178.97 \
CARGO_TARGET_DIR=/ABSOLUTER/PFAD/ZUM/LOKALEN/TARGET \
bash scripts/qa-mesh-native-two-host.sh
```

Für den **Negativtest**: M2 erhält zusätzlich `KATOSYNC_MESH_LAN_QA_NEGATIVE=YES`; auf M3 wird `ROLE=client-wrong-pin` verwendet. Der Launcher verlangt eine explizite Testfreigabe und existierende, vorbereitete Build-Artefakte. Vor Start des Servers sollten beide Rust-Testprogramme vollständig gebaut sein; der 45-Sekunden-Timeout startet erst nach `TcpListener::bind`.

## Nicht freigegeben

Der Endnutzer-Workflow **KATOOS-Login → vorhandene Identität im macOS-Keychain → SAS auf beiden Macs vergleichen und explizit bestätigen → beiderseitige `locally_approved`-Pins → serverseitiges Enrollment → native mTLS-Transportprobe → revokierbare Session** ist damit noch nicht Ende-zu-Ende getestet. Insbesondere wurde kein echter Pin in den produktiven Keychain geschrieben und kein `mesh_local_approved_peers`-Zustand verändert.

Die Live-Supabase-Inbox (vier Migrationen, zwei neue Edges) bleibt gesperrt. Kein Auto-Pairing, keine Remote-Jobs. Der Test ist ausschließlich der Nachweis, dass **die vorhandene native Rust-Transportschicht über zwei physische Rechner funktioniert und einen falschen Pin abweist**.
