# KatoSync Mesh – Stage 2R: Sender-validierter Posteingang

**30. Oktober 2026 · separater gestapelter Draft auf Stage 2Q / PR #183 · kein Deployment.**

## Reviewfund

Die bisherige Edge-Funktion `mesh-inbox-receive` prüfte vor dem LIST-Vorgang bereits die echte Supabase-Sitzung, die aktive KatoSync-Mitgliedschaft, eine korrekt registrierte Empfängeridentität und einen frischen **vom Empfänger signierten Ed25519-Nachweis** mit Nonce-Schutz. Bei der anschließenden Ausgabe der Einladungen prüfte sie aber lediglich die Struktur der gespeicherten Angebote. Die eigenständige Prüfung der ursprünglichen **Absendersignatur und Zielbindungs-Signatur** erfolgte bisher nur nativ im Mac-Client.

Dadurch konnte ein privilegiert fälschlich eingefügter, nachträglich beschädigter oder von einem später widerrufenen Sender stammender Inbox-Eintrag über die Edge-API zumindest als Rohangebot zum Client gelangen. Die native App verweigerte weiterhin die Vertrauensfreigabe, aber der Backend-Vertrag hatte eine unnötige Prüflücke.

## Umsetzung

- `mesh-inbox-send/send.ts` exportiert eine kompakte, von der POST-Verifikation **wiederverwendete** Funktion `verifyStoredSignedMeshInvite`. Sie nutzt **denselben Parser und dieselbe Ed25519-WebCrypto-Prüfung** wie der Sendepfad: Original-Angebot, Account-Scope, Source-/Target-Geräte-IDs, 32-Byte-Nonce, Ablaufzeit und die getrennte an den Empfänger gebundene Dispatch-Signatur. Fehler werden fail-closed behandelt.
- `mesh-inbox-receive/receive.ts` liest für bis zu zehn offene Angebote die eindeutigen Source-IDs in **einer** owner-gefilterten, begrenzten Service-Role-GET-Abfrage. Für jeden Sender ist die aktuelle Eintragung im selben KatoSync-Konto erforderlich, exakt `discovered`, nicht widerrufen und mit demselben Public Key wie im ursprünglichen Angebot.
- Jede gespeicherte Einladung muss nun vor der LIST-Ausgabe erneut beide Ed25519-Signaturen bestehen. Ungültige oder nicht abrufbare Senderdatensätze führen zu `503 INBOX_SOURCE_UNVERIFIED` bzw. `INBOX_SOURCE_UNAVAILABLE`. **Es werden keine ungeprüften Einladungen zurückgegeben.**
- Die LIST-Operation prüft die Ablaufzeit des Empfänger-Proofs nach den zusätzlichen Netzwerk- und Kryptografieoperationen erneut. Bei leerer Inbox erfolgt kein zusätzlicher Source-Roster-GET.
- LIST ist weiterhin **keine** Kopplung und keine Autorisierung. `paired=false`, `transportReady=false`, `remoteJobsEnabled=false`. Es werden keine Datenbank- oder UI-Rechte erweitert und keine neuen Secrets übertragen.

## Sicherheitsgrenzen und Negativtests

Reale Ed25519-WebCrypto-Integrationstests verwenden synthetisch generierte Sender- und Empfängerschlüssel (keine echte Keychain oder Live-Tokens). Abgedeckt sind:

- Positiv: frisches signiertes Original-Angebot und separate korrekt signierte Zielgeräte-Dispatch-Bindung
- Negativ: Sender widerrufen, falscher registrierter Sender-Public-Key, fremder Owner, Sender fehlt, Sender-Registry nicht erreichbar, manipulierte Angebots-Nonce, manipulierte Zielbindungs-Signatur
- Leere Inbox bleibt ohne Senderabfrage lesbar und ohne Vertrauen/Fernrechte
- Bereits vorhandene Empfänger-Proof-Tests und atomare Accept-/Reject-Prüfungen bleiben aktiv

## Prüfreihenfolge und nächster Freigabeschritt

Diese Änderung ist **rein im Quellcode** und hat **keine** Migration. Sie darf nur zusammen mit der weiterhin blockierten, überprüften Stack-Folge #177→#183 und neuem Draft auf ihr korrektes QA-Build-Ziel gelangen. Der sichere serverseitige LIST-Check ersetzt ausdrücklich **nicht** die native Nachprüfung, die frische Empfängerbestätigung vor Accept/Reject, das SAS, echte Key-Pins oder den mTLS-Widerrufswächter.

Offen: Kontrollierter Schema-/Edge-QA-Rollout mit unabhängiger Owner-Freigabe, echter signierter M2↔M3-Invite mit Keychain-Geräten und beidseitigem SAS, danach nicht-synthetischer mTLS-Kanal und Re-Auth. Remote-Writer bleiben gesperrt. Die SQL-Proof-Retention ist separat vor langfristigem Betrieb zu lösen; keine automatische Datenlöschung.

**Status:** Testbarer Backend-Sicherheitsvertrag vorbereitet; kein Live-Mesh-Verbindungsnachweis.
