# KatoSync Auto-Mesh – Account-basierte Gruppenmitgliedschaft

## Nutzerziel und UX-Vertrag
- Beim ersten Einrichten bietet KatoSync „Mein Mesh automatisch verwalten“ an. Dies ist eine **bewusste, einmalige Opt-in-Einstellung**, keine stillschweigende Zustimmung durch Kontoanmeldung.
- Geräte derselben verifizierten KatoSync-Identität werden automatisch **entdeckt**, nicht automatisch autorisiert.
- „Alle verbinden“ wird auf einem bereits vertrauenswürdigen Gerät einmal ausgelöst und kann eine Gruppe an geeigneten Geräten anmelden. Nicht paarweise A-B/A-C/B-C manuell: Nutzer besitzt eine konto-bezogene Mitgliederliste, signierte Device-Keys und ein gemeinsames **Trust Graph / Membership Roster**.
- Im Auto-Modus: Bereits vertrauenswürdige Geräte verbinden sich im Hintergrund wieder. Ein neues Gerät erhält eine einmalige passkey-basierte starke Kontoprüfung auf diesem Gerät, die eine an seinen Geräte-Key gebundene signierte Enrollment-Berechtigung liefert. Liegt eine vorher aktivierte, gültige Auto-Mesh-Owner-Policy vor, braucht es KEIN zweites Annehmen-Popup. Wenn die Prüfung fehlt/fehlschlägt: ausdrücklich bestätigen statt stillschweigend aufnehmen.
- Geräte erscheinen mit freundlichen lokalen Namen (z. B. selbst gewählte KI-Persönlichkeit) und Ressourcen-Badges; vertrauenswürdige Identität ist ausschließlich das persistente public-key fingerprint, NICHT ein Hostname oder vom Gerät selbst gemeldete Hardwaremerkmale.

## Sicherheitsinvarianten
1. Das gleiche Login/Refresh-Token ist **kein** Gerätetrust-Beweis. Account-Takeover, entwendete Refresh-Tokens, gemeinsame Konten oder verlorene Geräte gefährden sonst sofort alle verbundenen Geräte. Der Schutz bleibt auch beim selben Nutzer erforderlich.
2. IdP-passkey/WebAuthn ist eine separate **Konto-Authentifizierung**, der Mesh Ed25519-Key bleibt **gerätegebunden** im macOS Keychain/Windows DPAPI bzw. TPM. Kein gruppenweiter privater Signing-Key, niemals Geräte-Seeds übertragen.
3. Nur ein serverseitig/agentenseitig überprüfter Konto-Scope, gültige Owner-Opt-in-Policy, ein signierter frischer Device-Challenge und neue passkey-basierte Gerätaufnahme ermöglichen eine neue Mesh-Mitgliedschaft ohne weitere Popups.
4. „Auto“ heißt **erlaubte Wiederverbindung / sichere Mitgliedschaft**, nicht automatische Datei-, Projekt-, Shell- oder Schreibrechte. Erlaubnisse als eigene ACLs: Presence → Geräte-Status → ausgewählte Projektvorschau → explizite Dateien → Read-only-Aufträge → zusätzliche geschützte Schreibrechte.
5. Alle Geräte prüfen signierte Mitgliedschaft, Ablauf, Revocation-Epoch und kurzlebige mTLS-Transportidentitäten bei jeder Sitzung. Konto-/Geräte-Widerruf blockiert neue Verbindungen; Peer-Revocation invalidiert Gruppenmitgliedschaft und nötigenfalls rotiert E2E-Datenschlüssel.
6. Der erste Owner-Gerätwechsel, verlorene Schlüssel, Passkey-Reset, Recovery und ungewöhnliche Anmeldung erzwingen Step-up/prüfbare Recovery und deaktivieren vorläufig Auto-Enroll.
7. Rate-Limits, 5-Minuten-Einladungen, Replayschutz, Race-Cases und Device-Quota; maximale vertrauenswürdige Peers aktuell 10 in Rust. Auto-Erkennung auch über fremde Netzwerke nur nach Sessionprüfung mit kurzlebigem Relay, LAN optional mit rotierenden Pseudonymen.

## Architektur – Datenminimalismus
- KatoSync-Konto oder KATOOS-Federation → stabiler, issuer-gepinnter Mesh-Account-Scope; kein falscher Zusammenhang zwischen einem Mail-String und dem authentifizierten Konto.
- Öffentlicher Account-Device-Roster: device_id/public_signing_key, signed_account_scope, opt-in / status, alias/persona, letzte Sichtbarkeit, expiry, revoked_at/epoch. Keine Inhalte von Projekten oder lokalen Dateien im Presence-Service.
- Enrollment-Policy: owner_signed_opt_in, created_at, expires_at, max_devices, passkey_requirement, capabilities_default=presence_only.
- Relay liefert signierte Membership-Änderungen; Clients prüfen Protokoll selbst. Online-Backends sind nicht automatisch Trusted-Devices.
- Für ein 4-Geräte-Mesh kein manuelles O(n²) Klicken: Aufnahme in die eine Mitgliederliste reicht; einzelne mTLS-Verbindungen werden bei Bedarf automatisch auf Grundlage des signierten Rosters ausgehandelt.

## Implementierungsstand
- NEU: `src/lib/meshEnrollmentPlanner.ts` ist eine *rein lesende* UI-Entscheidungshilfe plus Regressionstests. Rückgabe `auto_enroll_candidate` bedeutet **keine** Berechtigung: das Native/Backend Gate muss alle Beweise unabhängig validieren; es wird weder Trust gespeichert noch Netzwerk gestartet.
- PR #153: einfacher manueller Einladungs-Start, keine automatische Discovery.
- Noch offen: echtes Passkey-Step-up / Enrollment-Attestation, Owner-Policy-Storage, RLS Relay/Presence, Signed Roster, Revocation-Epoch, mTLS, UI-Schalter „Auto“ und „Alle verbinden“, Mac/Win E2E Tests.
- M2 KATOOS QA-Sitzung wird aktuell vom Issuer zurückgewiesen; M3 hat eine funktionsfähige lokale Signing-Identity. Ohne Lösung dieses Blockers keine tatsächliche Kopplung behaupten.
