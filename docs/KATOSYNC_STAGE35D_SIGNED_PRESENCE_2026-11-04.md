# KatoSync 3.5d – signierter Presence-Heartbeat und Cloud-Isolation

Stand: 04.11.2026. Arbeitszweig feat/mesh-v35d-signed-heartbeat-20261104.

## Ursache

Vier registrierte App-Identitäten entsprechen zwei physischen Macs (je Stage3X und Stage35). Der letzte serverseitige Kontakt in katosync.mesh_devices wurde am 03.11.2026 erfasst, obwohl beide Stage35-Apps am Morgen des 04.11. liefen. Der bestehende Enrollment-Pfad aktualisiert last_seen_at bei der ersten Registrierung, nicht regelmäßig für bekannte Identitäten. Ein Last-Seen-Wert ist kein Beweis für lebendige P2P-Verbindungen.

## Neuer isolierter QA-Endpunkt

Der neue Supabase-Endpunkt mesh-device-presence-qa Version 1 wurde mit verify_jwt=true separat bereitgestellt. Die vorhandene Funktion mesh-device-enrollment bleibt Version 4 und wurde nicht verändert.

Jede Meldung enthält die bereits registrierte Device-ID, den bestehenden öffentlichen Ed25519-Geräteschlüssel, den engen signierten Zeitstempel und eine Signatur über Account, Device, Public-Key und Zeitstempel. Der Server kontrolliert den KATOOS-Login online, die separate aktive KatoSync-Mitgliedschaft, die serverseitige Mesh-Pro-/Trial-Berechtigung, den exakten Geräte-Datensatz und dessen nicht widerrufene Signaturidentität.

Nur die vom Server bestätigte last_seen_at-Spalte wird in katosync.mesh_devices aktualisiert. Ein konditionales PATCH beschränkt die Datenbank auf maximal einen Update-Versuch pro fünf Minuten und enthält Besitzer, Device-ID, Key und Revoke-State. Ein Widerruf oder eine ungültige Signatur führt zu keiner Aktualisierung. KatoOS, Picnic und TableRocket werden nicht geschrieben.

Das Protokoll setzt keine gegenseitige Vertrauensstellung, keinen mTLS-Tunnel und keinerlei Remote-Job-Rechte. Die Antwort enthält ausdrücklich paired=false, transportReady=false und remoteJobsEnabled=false.

## Native Stage35-QA-App

Ein neuer Tauri-Aufruf mesh_device_presence_report holt ausschließlich die bereits gespeicherte Keychain-Identität, ermittelt die eigene Device-ID aus einem verifizierten KATOOS-Roster und signiert den Report ausschließlich lokal. Er legt keinen neuen Schlüssel an und registriert keine zusätzlichen Geräte. Der optionale QA-Schalter VITE_STAGE35_HEARTBEAT_QA=1 aktiviert die sequenzielle Hintergrundmeldung alle zehn Minuten. Die Scheduler-Korrektur erneuert den Poller nach manuellen Operationen und setzt das Zeitfenster nach Kontowechsel zurück.

## Tatsächlich bestanden

- Acht Edge-Proof-/Sicherheitstests und fünf Wire-/UI-Vertragstests grün.
- Zwei native Rust-Signaturtests grün.
- TypeScript und Vite-Build mit Stage35-Heartbeat-Schalter grün.
- 649 von 649 vollständigen Node-Regressionstests nach Scheduler-Korrektur grün.
- Neuer QA-Endpunkt ohne JWT: HTTP 401. Beide Edge-Funktionen mit verify_jwt=true aktiv; die bestehende Enrollment-Version unverändert.

## Noch ausstehend

Noch kein erfolgreicher 200-Heartbeat auf den echten Macs: Die dort installierten, notarisierten Stage35-Apps enthalten den neuen Aufruf noch nicht. Der native Kandidat muss fertig gebaut, separat signiert, von Apple notarisiert und auf beiden Geräten getestet werden. Vorher darf niemand den neuen Cloud-Zeitstempel als nachgewiesenen Live-Peer-Tunnel interpretieren.

Weitere Release-Gates: sicher bestätigte gegenseitige SAS-/Ed25519-/mTLS-Verbindung, einmalige signierte Hello-Nachricht, freigegebene Projekt-Kurzstatistik, echter M2-M3-Remotejob mit Acknowledgement, sowie automatischer Hintergrundbetrieb und korrekte Geräteplatzverwaltung. Die ältere QA-Installation bleibt erhalten.

Wirtschaftlichkeit: Das Cloud-Heartbeat-Intervall ist absichtlich grob. Für zehntausende Nutzer ist später P2P-First-Presence mit seltener Cloud-Synchronisation vorgesehen, um Edge-Aufrufe und Datenbankkosten zu begrenzen.

## Abnahme auf beiden echten Macs – 04.11.2026

**Apple-Releaseprüfung:** Stage35d wurde aus dem gemeinsamen Cargo-Target des M2 neu kompiliert, unter der bestehenden QA-Bundle-ID mit Developer ID signiert, von Apple erfolgreich notarisiert und mit Stapler/CodeSign/Gatekeeper bestätigt. SHA-256 des Executables auf beiden Macs: `fad1176ded92aab4d83b773632ed5c5341a5f7bb10ee3572600d9ae80c77ee01`. Die vorherigen Stage35-Bundles liegen auf jedem Gerät unter `~/Applications/.KatoSync-Mesh-Stage35-Pre35d-20261104.app`, Stage3X bleibt separat.

**Übertragung M2 → M3:** Ein einmaliger HTTPS-LAN-Server mit selbstsigniertem, kurzlebigem TLS-Zertifikat, Zertifikat-SHA-Pinning sowie Archiv- und Binary-SHA-256-Validierung wurde ausschließlich für das notarisierten QA-Paket verwendet. M3 bestätigte dieselbe App-Signatur und Gatekeeper-Akzeptanz. Der Transfer-Server wurde nach einer Abholung geschlossen und alle temporären ZIP-/Schlüssel-/Zertifikatsdateien wurden gelöscht. Kein SSH aktiviert.

**Echter Heartbeat:**
- M2 Pro / KAI Nexus / bestehende Registration `lHjPv`: neue serverbestätigte `last_seen_at = 2026-11-04 08:24:47.143+00`.
- M3 / KAI Nika / bestehende Registration `Pqna2`: neue serverbestätigte `last_seen_at = 2026-11-04 08:31:04.744+00`.
- UTC+1: 09:24:47 und 09:31:04 MEZ. Die Werte wurden durch eine anschließende **direkte Supabase-SQL-Abfrage** bestätigt. Keine zusätzlichen Geräte-IDs, weiterhin vier App-Identitäten auf zwei physischen Rechnern.

**Interpretation:** Der signierte Agent-zu-Cloud-Meldeweg hat auf beiden echten Macs funktioniert. Er beweist keinen gegenseitigen Agententrust, keine echte P2P-Online-Sitzung, keine mTLS-Verbindung und keine Remote-Jobs. Aktuell 0 vertraute Devices, 0 Einladungen, 0 Relay-Nachrichten.

**Nächster harter Blocker:** Native Einladungs-, Empfangs- und Relay-Funktionen sind im Code vorbereitet. Die Endpunkte `mesh-inbox-send`, `mesh-inbox-receive` und `mesh-pairing-relay` sind in diesem Projekt bisher **nicht** als aktive Edge Functions gelistet und die getrennten QA-Flags sind deaktiviert. Vor der Freischaltung zuerst isolierte Serverdeployment-Sicherheitsprüfung, Owner-Opt-in und echte signierte SAS-/mTLS-Kopplung auf beiden Macs. Keine automatische Peer-Freigabe nur aufgrund gemeinsamer KATOOS-Anmeldung.
