# KatoSync Mesh Stufe 1C – explizite lokale Freigabe und Widerruf

Stand: 26. Oktober 2026. Der lokale Schlüsselnachweis Stage 1B wird um eine lokale, dauerhafte Geräteschlüssel-Freigabe ergänzt. Das ist noch keine aktive Netzwerkverbindung oder beidseitige Peer-Freigabe.

## Implementierung
- Nur nach zuvor erfolgreich verifiziertem, beidseitig signiertem Stage-1B-Ablauf wird ein freizugebender Peer-Key mit kurzlebigem Sicherheitscode im OS-Schlüsselbund vorgemerkt.
- Nutzer vergleicht den Code auf beiden Geräten über einen unabhängigen Weg und tippt den Code des anderen Geräts ein, klickt anschließend explizit „Lokale Gerätefreigabe speichern“. Genau dieser auf dem Gerät vorgemerkte frische Code und der passende öffentliche Ed25519-Schlüssel werden verifiziert. Keine Fremdgeräte über Namen/IP/RDC.
- Ein öffentlicher Key-Pin wird pro verifizierter KatoSync-Issuer-/Konto-UUID dauerhaft im macOS-Schlüsselbund gespeichert. Maximal 10 Einträge. Nach Neustart bleibt die lokale Zustimmung gespeichert; Wiedervorlage benötigt KatoSync-Sitzungsverifikation. Keine geheimen Schlüssel oder Tokens in der Liste oder im Frontend.
- UI unter Vision → Mesh-Bereitschaft zeigt nach manuellem „Liste laden“ ausschließlich lokal bestätigte öffentliche Gerätekennungen und je einen Widerrufen-Button. Bei Widerruf wird der Pin gelöscht und ein laufender Approval-Pending-Zustand verworfen.
- Kein Mesh-Listener, keine mTLS/TLS-Verbindung, keine Fernaufträge, keine automatische Freigabe oder selbständiger Reconnect implementiert. transportReady=false, remoteJobsEnabled=false, approvalOnly=true auf nativer Ebene, auch wenn die Liste nicht leer ist.

## Weitere obligatorische Gates
1. Sichere Credential-Store-Implementierung auf Windows separat durchführen; der bisherige Keyring ist ausschließlich auf macOS dafür freigeschaltet und blockiert unter Windows fail-closed.
2. Zwei echte Rechner mit installierter Beta, gegenseitigem Konto-Nachweis und identischem SAS auf beiden Bildschirmen, jeweils unabhängige Bestätigung und Revocation/E2E-Tests.
3. Native Gerätebestätigung über sichere Discovery/Handshake statt JSON-Copy-Paste, persistent revocable Peer-Trust inklusive Rotation, Remote-Revoke-Protokoll und Schutz vor konkurrierender Bestätigung. QA nach Konto-/Appwechsel, Offline/Resume, FileVault und Keychain-Prompts.
4. Standardsicheres TLS 1.3 mTLS über LAN-first und optional E2E-Relay, mit Peer-Pinning, frischen Sitzungsschlüsseln, verbindlicher Protokollversion, Anti-Replay/Timeout und später optional Hybrid-PQ X25519MLKEM768. AES-512 existiert nicht. Erst nach verifiziertem Transport einen read-only Auftrag übergeben.
5. Writer-Gate #76 bleibt gesperrt. Keine Freigabe für andere Konten, keine automatische Passwortfreigabe, keine öffentlich dokumentierten privaten Adressen, Token oder Gerätekennungen.

Branch und PR sind Draft. Keine Anwendung ohne erfolgreiche QA und explizite Benutzerbestätigung als verbunden darstellen.
