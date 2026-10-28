# KatoSync Mesh – Stage A: automatische Geräteerkennung

Stand 28.10.2026, Entwicklungs-/QA-Branch, nicht produktiv deployt.

## Nutzerfluss
1. M2 und M3 melden sich im gleichen verifizierten KATOOS-Konto an.
2. Verbindungen / KatoSync Mesh / Geräte finden startet einen nativen Scan.
3. KatoSync verifiziert das Konto bei der kanonischen KATOOS-Auth-Instanz und verwendet den vorhandenen Ed25519-Geräteschlüssel im OS-Schlüsselbund.
4. Die kontrolliert ausgerollte Edge Function stellt eine zufällige, 90 Sekunden gültige Challenge aus. Der Client hat keine direkten Schreibrechte auf die Datenbank.
5. Die native Rust-Komponente signiert Konto-UID, Challenge-ID, Nonce, Public Key und absolutem Ablaufzeitpunkt. Der private Schlüssel wird ausschließlich im nativen Rust-Prozess aus dem OS-Schlüsselbund geladen und niemals über IPC oder Netzwerk übertragen.
6. Der Server verifiziert die Signatur über WebCrypto Ed25519 und verbraucht die Challenge atomar.
7. Nur der Server schreibt eine Discovery-only-Gerätezeile. Das native KatoSync liest die durch RLS geschützte Geräteliste.

## Sicherheitsgrenzen
- Fest vorgegebener Server; keine frei übergebene URL.
- Discovery ist KEINE Pairing-Freigabe, mTLS-Verbindung, Remote-Job- oder Writer-Berechtigung.
- Besitzerwechsel der KATOOS-Sitzung bricht den Ablauf ab.
- Kein direkter Schreibzugriff für normale Clients, keine Geheimnisse im UI.
- Serverseitige Gerätequote, global eindeutige Public Keys, transaktionsgesicherter Quota-Trigger.
- Challenge ist 90 Sekunden gültig, ein einziges Mal verwendbar; serverseitige Rate Limits.
- Passkey-, SAS-, mTLS- und explizite Trusted-Pairing-Gates für Fernzugriff bleiben getrennt.

## Rollout
- Die signierten M2- und M3-QA-Apps enthalten PR #159. Die Backend-/Rust-Änderungen dieses Branches sind noch nicht in den installierten Apps.
- Das Produktions-KATOOS enthält aktuell weder die Device-Registry von PR #155 noch die neue Challenge-Tabelle. Keine produktiven Datenbankänderungen vorgenommen.
- Für Live-Tests nötig: separate QA-Datenbank oder geprüfte Schema-Freigabe, Edge Function mit Stage-Flag challenge-and-discovery, SQL-Advisors, RLS-Negativtests, anschließend M2/M3-Builds und End-to-End-Test.
- Service-Role-Key ausschließlich auf dem Server, niemals im Mac-Bundle oder GitHub.
- Ohne aktivierte Serverfunktion bleibt Geräte finden fail-closed.

## Prüfungen
- Lokale isolierte PostgreSQL-17-Datenbank ohne Listener: MESH_RLS_LOCAL_TESTS_PASS, MESH_ENROLLMENT_CHALLENGE_RLS_PASS, MESH_DEVICE_QUOTA_AND_UNIQUE_KEY_PASS.
- Node/TypeScript/Web-Tests, native Rust-Tests, Code-Signatur und QA-Checks getrennt.
