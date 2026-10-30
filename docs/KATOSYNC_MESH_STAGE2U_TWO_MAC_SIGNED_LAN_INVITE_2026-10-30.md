# KatoSync Stage 2U – Signierte Einladung über das echte M2↔M3-LAN

**30. Oktober 2026.** Isolierter manueller QA-Nachweis. Entwicklungsbranch auf Stage 2T / PR #186. **Keine Änderung an Supabase, echten KatoSync-Keychains, installierten Mac-Apps oder Fernzugriffsrechten.**

## Ziel und tatsächliches Ergebnis

Stage 2P hatte zuvor **echte TLS-1.3-Übertragung mit gepinnten mTLS-Testzertifikaten** zwischen M2 und M3 demonstriert, aber nur einen synthetischen Nonce-Echo-Transport. Stage 2T hatte **echte Ed25519-signierte Sender-/Empfänger-Inbox-Flows samt SQL-Triggern** auf einer isolierten Datenbank demonstriert, aber auf nur einem Mac.

**Stage 2U** sendet nun eine mit frisch erzeugtem M2-Ed25519-Key signierte Mesh-Inbox-Einladung tatsächlich über das private LAN zu einem M3-Prozess. Dieser prüft die TLS-Serverzertifikats-Pinbindung sowie die beiden Ed25519-Absendersignaturen (Originalangebot und empfängergebundene Dispatch-Signatur) und sendet einen eigenständig signierten Empfänger-Nachweis mit frischer Nonce zurück. M2 prüft diesen Empfängernachweis und antwortet ausdrücklich ohne Vertrauens- oder Transportfreigabe.

### Auf den beiden Macs beobachtete Testbelege

| Prüfung | Mac | Ergebnis |
|---|---|---|
| Source-Datei auf M2 und M3 | Beide | SHA256 `f4e98562aa29713791b3811ed8ebdf208ae69d449e1415470aa0cf8f26ced4b2` |
| Standardstart ohne QA-Freigabe | Beide | `MESH_TWO_HOST_BLOCKED:SYNTHETIC_LAN_OPT_IN_AND_EXACT_LOCAL_ADDRESSES_REQUIRED` |
| Absichtlich falscher TLS-Zertifikats-Pin | M3 → M2 | `MESH_TWO_HOST_WRONG_CERT_PIN_REJECTED`, Exit 0 |
| Signierte M2-Einladung tatsächlich empfangen | M3 | `MESH_TWO_HOST_QA_SIGNED_INVITE_RECEIVED`, Exit 0 |
| M3-Signatur für Request/Action/Nonce/Expiry am M2 überprüft | M2 | `MESH_TWO_HOST_SYNTHETIC_ED25519_ACK_VERIFIED`, Exit 0 |
| Abschlussbeleg vom M2 empfangen | M3 | `MESH_TWO_HOST_QA_RECEIPT_VERIFIED`, Exit 0 |

Die erste getestete Verbindung verwendet **ein Zertifikat, das nur für diese QA-Ausführung erzeugt wurde**, TLS 1.3 mit gepinntem Zertifikats-SHA256, und private IPv4-Adressen im gleichen LAN. Der Server akzeptiert nur die explizit freigegebene Peer-IP; der Client prüft den genauen Zertifikats-Pin vor Verarbeitung der Einladung. **Dieser Stage-2U-Test ist kein beidseitiges TLS auf Basis der echten Geräteschlüssel**; Stage 2P enthält den separaten synthetischen mTLS-Nachweis.

## Testaufbau und Wiederholung

- Das QA-Skript `scripts/qa-mesh-two-host-signed-invite.mjs` akzeptiert ausschließlich explizites `KATOSYNC_MESH_LAN_QA_ALLOW=SYNTHETIC_FIXTURES_ONLY`, `ROLE=server|client|client-wrong-pin`, zwei explizite private IP-Adressen und den festen QA-Port `49331`. Default ohne Freigabe ist Abbruch **vor dem Öffnen eines Ports**.
- Der Server-Helfer `scripts/qa-mesh-two-host-signed-invite-server.sh` erzeugt eine kurzlebige selbstsignierte RSA-TLS-Bescheinigung und Schlüssel in einem privaten `/tmp/ksmesh2u.XXXXXX`-Verzeichnis, startet den Node-Server und löscht Zertifikatsdateien beim Beenden.
- Server, exemplarisch auf M2: Environment `KATOSYNC_MESH_LAN_QA_ROLE=server`, `KATOSYNC_MESH_LAN_QA_ADDRESS=192.168.178.97`, `KATOSYNC_MESH_LAN_QA_EXPECT_PEER=192.168.178.165`, `KATOSYNC_MESH_LAN_QA_PORT=49331` und der obige Opt-in; dann `bash scripts/qa-mesh-two-host-signed-invite-server.sh`. Die Konsole gibt den öffentlichen Zertifikats-Fingerabdruck aus.
- M3 führt dieselbe JS-Datei lokal mit `ROLE=client-wrong-pin` (negativer Test, zusätzlich `KATOSYNC_MESH_LAN_QA_WRONG_PIN=YES`) und anschließend `ROLE=client` aus, setzt eigene und Server-IP umgekehrt sowie `KATOSYNC_MESH_LAN_QA_CERT_PIN` auf den **exakten** vom Server veröffentlichten SHA256-Fingerabdruck.
- Server beendet sich nach einem erfolgreichen positiven Empfängernachweis; es gibt keinen Hintergrundlistener und keine Persistenz.
- Das Standalone-Skript kann nach Test auf dem M3 wieder entfernt werden. **Keine** mit ihm generierten Schlüssel gehören zum KatoSync-Produktions-Keychain.

## Sicherheitsgrenzen

Die Ed25519-Nachrichten folgen den Protokollformaten `katosync-mesh-pairing-v1`, `katosync-mesh-inbox-send-v1` und `katosync-mesh-inbox-recipient-v1`, mit demselben Account-Scope- und Payload-Aufbau wie die Inbox-Edge-Handler. Der Empfänger hat seinen öffentlichen QA-Schlüssel **nur im Testnachweis** vorgelegt; dadurch ist die Signaturprüfung echt, die Registrierung des Geräts aber **nicht** belegt.

Keine Cloud-Datenbank, keine Auth-Session, kein KATOOS-Konto, kein realer Keychain-Seed, kein Benutzer-SAS und keine App-UI waren beteiligt. Die Antworten enthalten stets `paired=false`, `transportReady=false`, `remoteJobsEnabled=false`. Es wird **kein** M2/M3-Mesh-Pairing und kein Fernjob behauptet.

## Nächste Freigabegates

1. GitHub-Stack #177–#186 und neuer Stage2U-PR prüfen und die Datenbank-/Edge-QA-Freigabe unabhängig bestätigen. Die vier Inbox-Migrationen und zwei Edge-Funktionen existieren bislang **nur als Draft-Quellcode**.
2. Eine echte signierte M2→M3-Einladung mit den im lokalen Keychain registrierten Geräten, online authentifizierten KatoSync-Konten, einer von beiden Nutzern bestätigten SAS und den einmaligen Inbox-Proofs über Supabase zeigen.
3. Erst danach eine **echte** geräteidentitätsgebundene mTLS-Session mit Widerrufskontrolle autorisieren; alle Remote-Reader und Remote-Writer bleiben bis zur gesonderten Freigabe gesperrt.
