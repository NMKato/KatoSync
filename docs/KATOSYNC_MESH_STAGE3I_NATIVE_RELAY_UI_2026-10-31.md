# Stage 3I – Native Tauri-Relay-Anbindung und explizite Mesh-Bedienführung

**31.10.2026 · NMKato Solutions** · Aufbauend auf Stage 3H (Draft PR #200). **Der Relay-Server und die fünf SQL-Migrationen sind nicht in Produktion ausgerollt.**

## Implementiert

Die beiden neuen nativen `#[tauri::command]`-Operationen sind im Tauri-Handler registriert:

- `mesh_pairing_relay_send(requestId, recipientDeviceId, kind, payloadJson)`: Versendet nur ein nachweisbar authentisches, **öffentliches** Challenge- oder Response-JSON. Es wird erneut mit der vorhandenen lokalen Ed25519-Keychain-Identität signiert. Der zugehörige Account muss online verifiziert, das Absendergerät im verifizierten Konto registriert, das Empfängergerät zulässig und die Nachrichtenrichtung zur enthaltenen echten Ed25519-Challenge-/Response-Signatur passend sein. Eine fehlende Identität wird mit `existing_identity` abgewiesen, **nicht** erzeugt. Der Server-Receipt muss strikt `deliveryOnly=true`, `paired=false`, `transportReady=false`, `remoteJobsEnabled=false` enthalten. Signierte kurzlebige Umschläge binden Konto, Einladung, Sender/Empfänger, Art, Payload, Nonce und Ablaufzeit.
- `mesh_pairing_relay_list()`: Erstellt nur auf Klick einen frischen, kurzen Ed25519-Empfängernachweis mit der existierenden Keychain-Identität, fragt den QA-Relay-Edge-Dienst ab und **verifiziert alle Nachrichten zusätzlich in Rust**: äußere Signatur mit dem aktuellen registrierten Senderschlüssel, eigenen Empfangsgerät-ID, Richtung, Ablaufzeit sowie innere originale Ed25519-Challenge beziehungsweise -Response (vorhandene `mesh_handshake`-Produktionprädikate). Defekte oder unerwartete Antworten werden vollständig abgewiesen, bevor sie JS erreichen. Kein automatisches Polling.
- `mesh_handshake::relay_public_peer_keys`: Reine, zustandsfreie native Prüfung eines öffentlichen Challenge-/Response-JSON über das bereits geprüfte Besitznachweisprotokoll; **keine** Keychain-Mutation, keine Bestätigung und kein Transportrecht.

Der Client ist dreifach geschlossen: Cargo-Feature `katoos-auth-qa`, Kompilierungseinstellung `KATOSYNC_MESH_PAIRING_RELAY_QA=1` und sichtbarer UI-QA-Schalter `VITE_KATOOS_AUTH_QA=1` + `VITE_MESH_RELAY_QA=1`. Der Edge-Server muss unabhängig `KATOSYNC_MESH_PAIRING_RELAY_STAGE=qa-relay` freigeben. Alle Schalter sind standardmäßig aus. Keine Service-Role-Credentials in der Anwendung.

### Mesh-Karte

1. Empfänger nimmt eine signierte Inbox-Einladung ausdrücklich an und erzeugt über einen weiteren Klick die öffentliche Challenge.
2. **Challenge sicher senden (QA)** sendet die Challenge erst nach einem weiteren Klick. Der Datensatz wird nur als *zugestellt, nicht gekoppelt* gekennzeichnet.
3. Einladender klickt **Signierte Nachrichten prüfen (QA)**. Nach dem erneuten unabhängigen Rust-Check kann er **Antwort ausdrücklich erstellen** aufrufen. Die bestehende native Funktion `mesh_pairing_response_create` prüft den lokal noch gültigen Original-Offer-Keychain-Status, erstellt die Ed25519-Response und einen SAS-Code. Sie führt keine eigentliche Gerätefreigabe durch.
4. Erst **Antwort sicher senden (QA)** stellt die signierte Response im Relay bereit.
5. Empfänger klickt erneut **Signierte Nachrichten prüfen (QA)** und **Antwort ausdrücklich prüfen**. Die bestehende Funktion `mesh_pairing_response_verify` führt die lokale kryptografische Gegenprüfung gegen den **eigenen** Pending-Challenge-Keychain-Eintrag durch. Danach wird der SAS-Code angezeigt. **Nur der manuelle Abgleich und eine gesonderte explizite lokale SAS-Freigabe** können zur künftigen sicheren Zulassung führen.

Es werden keine automatischen `mesh_local_approve_peer`-Aufrufe, TLS-Listener, Remote-Jobs, grünen Pseudo-Verbindungsstatus oder impliziten Inbox-Polls erzeugt. Sämtliche Relay-Aktionen haben synchrone Double-Click-Sperren, Stale-Generation-Kontrollen und werden beim Konto-/Statuswechsel zurückgesetzt. Vier bestehende UI-Sprachen (DE/EN/ES/RU) vollständig ergänzt. Die technischen manuell kopierbaren Handshake-Funktionen und der Peer-Widerruf unter „Details“ bleiben erhalten.

## Testnachweise

- **476/476 Node-Regressionstests bestanden**, einschließlich vier neuer Stage3I-Quell-/Sicherheitskontrakte.
- **234/234 aktive Rust-Tests bestanden (8 ignored)**, einschließlich drei neuer Stage3I-Tests (Ed25519-Umschlag/Role-Binding, signierter Lese-Nachweis und originale native Challenge-/Response-Payload-Validierung mit Negativfällen).
- TypeScript, Vite-Produktionsbuild, `cargo fmt --check` bestanden.
- **Echter Google-Chrome-/Playwright-Klickpfad auf dem physischen M2** (isolierter Vite-Localhost, **synthetisch gemocktes Tauri-IPC**, keinerlei Live-Cloud-Aufruf):
  - „Empfänger“: Einladung annehmen → Challenge explizit vorbereiten → noch kein Send → doppelt auf „Challenge sicher senden (QA)“ klicken → **genau ein nativer Send**.
  - „Initiator“: Relay ausdrücklich prüfen → erst nach separatem Klick echte Response-Funktion aufrufen → Response ausdrücklich senden → **genau eine Response und ein Send**; SAS-Code sichtbar.
  - „Verifizierer“: Relay ausdrücklich prüfen → Response erst nach gesondertem Klick verifizieren → SAS-Code sichtbar; kein falscher „Verbunden“-Status.
  - Protokoll: `QA_STAGE3I_RECEIVER_PASS`, `QA_STAGE3I_INITIATOR_PASS`, `QA_STAGE3I_VERIFIER_PASS`, `MESH_STAGE3I_CHROMIUM_EXPLICIT_RELAY_PASS 3`.
- **Realer isolierter PostgreSQL-17-Unix-Socket-Test** gegen die Stage3H-Migration und Vorgängermigrationen erneut bestanden: `MESH_RELAY_LOCAL_SQL_SECURITY_PASS`, `MESH_QA_ALL_SQL_ASSERTIONS_PASSED`.
- Synthetischer Browser-Harness und sein Loopback-Server wurden wieder entfernt. Keine installierte App verändert, keine Credentials aus dem echten Keychain entnommen, keine Datenbankmigration und kein Edge-Dienst produktiv ausgerollt. Release-Lock bleibt maßgeblich.

## Noch offen

Der **echte** M2↔M3-Ablauf mit denselben KATOOS-Konto-Sitzungen und Ed25519-Identitäten sowie die signierte Relay-Kommunikation über einen tatsächlich freigegebenen QA-Edge-Dienst müssen separat mit ausdrücklich erlaubten Gerätefreigaben getestet werden. Das externe M3-DevSSD war bei Stage3I weiterhin nicht eingehängt; keine automatische Unlock-/Volume-Manipulation. Der M2 hat wenig freien Speicher.

**Nicht behauptet:** Produktiv funktionierendes Auto-Pairing, eigenständiges SAS-Matching, dauerhaftes Peer-Pinning, aktivierte TLS-1.3-Session, freigegebene Remote-Aufträge oder ausgelieferter Installer. Stage3I ist eine geprüfte und noch nicht ausgerollte Clientintegration.
