# KatoSync Stage 3J – Echter Rust→Edge-Signaturvertrag geprüft (noch kein Live-Pairing)

**31. Oktober 2026 · NMKato Solutions** · Baut auf Stage 3I / Draft PR #201 auf. **Entwicklungs-/QA-Änderung, keine Produktivfreigabe.**

## Ausgangslage und konkrete Prüfungslücke

Stage 3H hatte einen isoliert getesteten JavaScript/WebCrypto-Relay-Server mit signierten synthetischen JavaScript-Nachrichten; Stage 3I ergänzte die echten nativen Tauri-Sende-/Empfangskommandos und eine in Chromium simulierte Bedienführung. Was bislang noch fehlte, war der **direkte Beweis, dass eine mit dem echten Rust-Serializer und `ed25519-dalek` signierte Challenge und Response von der realen Edge-Kryptografie akzeptiert wird**, einschließlich Postgres-JSONB-Reihenfolge und signierter Empfängerabrufe.

Dieser Nachweis ist nun automatisiert, ohne Produktion, Cloud-JWT oder echte Geräteidentitäten zu benötigen.

## Implementierung

1. Ein **ausschließlich unter `#[cfg(test)]` verfügbarer** Rust-Transkript-Helfer in `src-tauri/src/mesh_handshake.rs` erzeugt mit den tatsächlichen `generate_challenge`-/`generate_response`-Funktionen ein signiertes, synthetisches Gespräch zwischen zwei unterschiedlichen Test-Ed25519-Schlüsseln.
2. Ein nativer Test in `src-tauri/src/mesh_relay_client.rs` verwendet `mesh_identity::make_test_offer`, diese real signierten Challenge-/Response-Objekte, die produktiven `make_envelope`- und `signed_list`-Funktionen. Er prüft die äußeren Signaturen mit dem nativen Verifier und gibt einen klar markierten **öffentlichen Testdatensatz ohne private Schlüssel oder Tokens** aus: `KATOSYNC_STAGE3J_RUST_FIXTURE=...`. Feste Testzeit und ausschließlich Test-Seeds; keinerlei macOS-Keychain-Zugriff.
3. Eine einmalig aus einem erfolgreichen Rust-Test erzeugte öffentliche Referenzdatei unter `tests/fixtures/meshRelayRustEd25519Stage3J.public.json` wird durch fünf Node/WebCrypto-Tests mit **dem wirklichen Edge-Protokollcode** verifiziert. Sie beweisen authentische Rust-Signaturen für beide Richtungen, beiden separat signierten Geräteabrufe, korrekte JSONB-Neusortierung und Ablehnung bei gefälschtem Owner/Device, Nonce, Payload, Ablaufzeit, Richtung und verändertem Original-Offer.
4. Zwei zusätzliche Edge-Integrationstests geben diese **echten Rust-signierten Testbytes** an den vorgesehenen `handleMeshPairingRelay`-Handler: Challenge von registriertem B→A speichern, A mit signiertem Einzelabruf lesen, Response von A→B speichern, B mit seinem eigenen signierten Abruf lesen. Es gibt eine simulierte JWT-Verifikation und **vollständig isolierte** PostgREST-Schnittstelle. Der Test lehnt doppelt verwendete Read-Nonces, Response ohne Challenge, widerrufene Geräte, ausstehende Einladungen, manipulierte Signaturen, falsch bestätigte Datenbankantworten und fehlenden QA-Schalter ab. Antworten bleiben `paired=false`, `transportReady=false`, `remoteJobsEnabled=false`.
5. Neues jederzeit reproduzierbares Skript `scripts/qa-mesh-rust-edge-interop-stage3j.mjs`: startet genau den nativen Rust-Test mit Cargo `--offline`, extrahiert die **frisch erzeugten** öffentlichen Nachrichten in ein eigenes `0700`-Tempverzeichnis und führt anschließend die beiden Node-Testdateien mit genau diesen neuen Bytes aus. Verweigert fehlende oder unerwartete Fixtures sowie geheime Datenfelder. Löscht temporäre Dateien im `finally`. Verändert **keine** Repo-, Cloud-, Installer- oder echten Keychain-Daten und aktiviert keinerlei QA-/Produktionssendeschalter.

**Befehl (auf einer autorisierten macOS-Entwicklungsmaschine mit Cargo-Cache):**

```sh
CARGO_TARGET_DIR=/Pfad/zu/vorhandenem/target node scripts/qa-mesh-rust-edge-interop-stage3j.mjs
```

Ausgabe beim tatsächlichen M2-Test:

```
STAGE3J_RUST_SIGNED_INTEROP_PASS: freshly generated Rust/Serde Challenge+Response+signed-read proofs validated by WebCrypto/Edge, 7/7 QA tests
```

## Prüfgrenzen und offene Freigabesperren

- **Das Skript verwendet echte Rust-Ed25519-Signaturen und echte Edge-Validierung, aber keinen produktiven Server und keine echten Geräte.** Die Online-Auth-/PostgREST-Schnittstellen sind für die Tests simuliert, und ein Testzeitpunkt wird ausdrücklich vorgegeben.
- Die lokale PostgreSQL-17-RLS-/Expiry-/Replay-Prüfung aus Stage 3H/3I wird separat nochmals mit `bash scripts/qa-mesh-postgres-local.sh inbox-relay` ausgeführt; sie ist kein Supabase-Cloud-Deployment.
- M3-Remoteverbindung funktioniert, jedoch ist `/Volumes/DevSSD` weiterhin nicht eingehängt. Es wird **nicht** automatisch entsperrt oder gemountet.
- Im Live-KATOOS-Supabase existieren weiter zwei nur erkannte, **null vertraute** Geräte; vier Inbox-Migrationen plus eine Relay-Migration und neue Edge-Dienste sind **nicht** ausgerollt. Keine echte Einladung oder SAS-Zustimmung wurde angelegt.
- **Noch erforderlich:** explizit freigegebene isolierte Cloud-QA-/JWT-Umgebung (inklusive Migrationen und Edge) oder äquivalente authentifizierte lokal bereitgestellte E2E-Infrastruktur, reale M2/M3-Client-Installation und Testkontositzungen, bewusster SAS-Abgleich auf beiden Geräten, echte Keychain-Trust-Pins, anschließender mTLS-Widerrufstest. **Keine automatische Verschmelzung/Merge/Release.**

Stage 3J liefert damit einen wesentlich stärkeren, reproduzierbaren Nachweis über die Sprach- und Crypto-Grenze, **nicht** den Beweis einer echten zugelassenen Mesh-Verbindung.
