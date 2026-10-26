# KatoSync Mesh – Stufe 1A: kryptografische Geräteidentität und signierte Einladung (26.10.2026)

## Ausgangspunkt
Stufe 0 in Draft #140 zeigt tatsächliche lokale Heartbeats, jedoch null gekoppelte Geräte. Im gleichen LAN sind M2 und M3 wechselseitig per ICMP erreichbar. Das ist keine Geräteauthentifizierung und kein sicherer KatoSync-Transport.

## Technisch implementiert
- Ed25519-Geräteidentität pro verifiziertem KatoSync-Supabase-User und Installation; 32-Byte-Schlüssel nur im OS-Keychain, niemals in der Frontend-IPC, in Projektdokumenten oder über Netztransporte. Keine vorhandenen GitHub-/Codex-Schlüssel wiederverwenden.
- Jedes Gerät hat eine SHA-256-basierte öffentliche Fingerprint-Darstellung (16 Byte von SHA-256, hexadezimal; kein privater Schlüssel).
- Nach ausdrücklichem Klick kann eine zeitlich auf 5 Minuten begrenzte Einladung erstellt werden. Inhalt: Protokollversion, öffentlicher Schlüssel, zufällige Nonce, Ablaufzeit, nur gehashter Konto-/Issuer-Scope und Ed25519-Signatur. Die Einladung ist kein Geheimnis.
- Gegenstelle kann den JSON-Text manuell importieren und die Signatur, Konto-/Issuer-Zugehörigkeit, Gültigkeitsdauer und Datenlänge prüfen. Vor und nach der Schlüsselaktion wird die autoritative KatoSync-Benutzeridentität erneut geprüft; bei zwischenzeitlichem Kontowechsel wird die Aktion abgebrochen. Ungültige oder abgelaufene Angebote werden fail-closed abgelehnt.
- Vision → Mesh-Bereitschaft enthält einen opt-in-Bereich „Gerätekennung und Pairing-Vorbereitung“, sichtbar in vier Sprachen. Signatur gültig bedeutet **NICHT gekoppelt**. Keine Freigabe durch Kopieren/Einfügen allein.
- Bestehende Mesh-Readiness meldet weiterhin **0 verifizierte Peers**, keinen Peer-Kanal und gesperrte Remote-Jobs/Writes. Keine heimlichen Listener, Netzwerkanfragen, Pairing-Registrierung, Scheduler oder Konto-/Schlüssel-Migration.

## Wichtige Grenzen / nächste Gates
1. Noch kein **gegenseitiger** Beweis, dass beide Gegenstellen ihre privaten Schlüssel tatsächlich besitzen, keine Einmal-Nutzungserzwingung für Einladungen, kein beidseitiger Bestätigungscode und kein dauerhaftes Vertrauensverhältnis. Die Signatur ist selbst-signiert und beweist Integrität, keine Vertrauenswürdigkeit vor Nutzerbestätigung.
2. Nächste Umsetzung: unabhängige, eindeutige Challenge/Response-Nachricht vom M3, Prüfung und Bestätigung von beiden Geräten, sicherer Peer-Key-Speicher mit Widerruf. Verifikation von Benutzerkonten muss Fail-Closed und mit derselben autoritativen KatoSync-Issuer-Bindung funktionieren (Issue #114, noch kein KATOOS-SSO).
3. Danach beidseitig authentisierter, verschlüsselter LAN-Transport inklusive Timeout, Replay-Prevention und Revocation. Erst danach genau ein read-only Git-Metadatenjob mit unverändertem HEAD/Status.
4. Sicherheitsschleuse #76 verbietet Cross-Device-Writer weiterhin. Eine LAN-IP, Gerätename oder RDC-Online-Status darf keinen Peer automatisch autorisieren. macOS/Windows-Installer, Logout-/Kontowechsel und Offlineverhalten müssen getrennt getestet werden.

## Datenschutz und Status
Öffentliches Repo: nur Quellcode, Test-Fixtures und sachliche Architektur, keine privaten Einladungen, Schlüssel, Kontokennungen, lokalen Adressen, Screenshots oder PII. Alle Testidentitäten sind synthetisch und deterministisch.

**Lokale QA auf M2:** 236 Frontend-Tests, 175 Rust-Tests bestanden (7 ignoriert), TypeScript/Vite sowie nativer macOS-Build grün. Die ausschließlich separate QA-Test-App wurde mit Rollback-Kopie aktualisiert, eine Instanz läuft und Gemma Vision blieb aktiv. Stufe 1A ist eine Vorbereitung, noch keine aktive Mesh-Kopplung; eigener gestapelter Draft-PR auf #140, keine Main-Freigabe.
