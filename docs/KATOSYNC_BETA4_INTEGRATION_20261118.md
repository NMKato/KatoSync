# KatoSync 4.0: private Beta-Integration vom 18. November 2026

## Zweck und Umfang

Dieser Entwicklungszweig verbindet die bereits vorhandene Kontoanmeldung,
Geräteregistrierung und SAS-Kopplung mit einem tatsächlich gestarteten nativen
Mesh-Dienst und der getrennten Remote-MCP-Freigabe. Die Produktbezeichnung 4.0
ist das Integrationsziel. Die Paketversion 2.0.0 und bestehende signierte
QA-Installationen sind damit nicht rückwirkend ein veröffentlichtes 4.0-Release.

Desktop: `beta/4.0-integration-20261118`,
[Integrations-PR #283](https://github.com/NMKato/KatoSync/pull/283).
Connector: `beta/4.0-runtime-integration-20261118` im Repository
[NMKato/KatoSync-Remote-MCP](https://github.com/NMKato/KatoSync-Remote-MCP/tree/beta/4.0-runtime-integration-20261118).

## Aktueller Quellstand nach Candidate 3

Diese Ergänzung vom **18. November 2026** unterscheidet den neuen Quellstand
vom unten dokumentierten signierten Candidate-3-Paket. Neue Funktionen
erhalten erst nach ihrem eigenen App-/Gerätetest eine entsprechende Abnahme.

| Bereich | Jetzt belegt | Weiter offen |
|---|---|---|
| Projektwissen | Projektgebundenes RAG; sichtbarer manueller Refresh mit geprüfter Sicherung und erneuter Quellen-/Git-Bindung | Ausführung der vier neuen echten Git-/SQLite-Nativtests im finalen Mac-Build und aktueller Offline-Inferenzlauf |
| Obsidian / Markdown | Export der gespeicherten Projektion über bestehenden nativen Befehl und Ordnerdialog; sieben neue Verhaltenstests bestanden | Nativer Klickpfad und Dateiexport im finalen Paket; keine automatische oder bidirektionale Synchronisation |
| Nativer Git-Status | Explizite Clientfreigabe und lokale Projektauswahl, signierter lesender Vertrag, gezielte native Harness-Nachweise | Voller Mac-App-Build und tatsächlicher ChatGPT-Aufruf mit frischer Freigabe |
| Desktop-QA | **997 Node-Tests**, keine übersprungenen Tests, am zusammengeführten Code-Stand `65f664a`; TypeScript und Vite-Build auf M2 bestanden | Native M2-Kompilierung nach 55 Minuten bei Abhängigkeiten abgebrochen, kein nativer PASS; abschließender CI-/Paketlauf offen |
| Connector-QA | Beide isolierten **PostgreSQL-17-Modi** bestanden; **658 Node-, 32 Worker- und 14 Workerd-Tests** bestanden | Produktiv **2/4 Migrationen angewendet**; dritte Ausführung abgebrochen, kein erneuter Versuch; Produktfreigabe, Worker, echte MFA, Gerät und WSS offen |
| Abhängigkeiten | Frischer Registry-Audit um **17:52 UTC: Exit 0, null Befunde** auf Linux und M3 | Abschließender CI-Gate für den finalen Release-Quellstand; ältere rote CI-Ergebnisse bleiben historisch |

Details: [Projektwissen und Export](KATOSYNC_BETA4_PROJECT_KNOWLEDGE_20261118.md),
[nativer Git-Status](KATOSYNC_BETA4_NATIVE_GIT_STATUS_20261118.md),
[frischer Audit](KATOSYNC_BETA4_DEPENDENCY_AUDIT_20261118.md) und
[Connector-Vertrag mit beiden PostgreSQL-Modi](https://github.com/NMKato/KatoSync-Remote-MCP/blob/beta/4.0-runtime-integration-20261118/docs/BETA4_EXPLICIT_NATIVE_GIT_STATUS_20261118.md).

Automatische Cross-Repo-Abfragen, ein produktiver Writer für
`PROJECT_STATUS_FLOW.md`, Mesh-Wissensreplikation, automatischer
Providerwechsel auf Local Brain und allgemeine Terminal-/CLI-/Computersteuerung sind
weiterhin offene Integrationsziele. Ein Mesh-Heartbeat, ein Git-Leseauftrag
oder ein Snapshot-Export nimmt diese Ziele nicht ab. **Das vollständige 4.0-Go
bleibt offen.**

## Ablauf für den eigenen Mesh-Test

1. Beide Anwendungen mit demselben KATOOS-Konto anmelden. Für diesen privaten
   macOS-Test müssen beide Rechner im selben aktiven Tailscale-Konto liegen.
2. **Verbinden** liest die aktuelle Kontoliste. Eine Registrierung ist eine
   App-Identität; mehrere frühere QA-Installationen sind nicht automatisch
   mehrere physische Rechner. Historische Einträge sind getrennt sichtbar.
3. Ein Gerät auswählen. Unbekannte Schlüssel benötigen Einladung,
   Gegenbestätigung und den vorhandenen SAS-/Keychain-Pin-Ablauf. Bereits
   bestätigte Gegenstellen werden wiederverwendet, nicht erneut eingeladen.
4. Auf einem Rechner **Server**, auf dem anderen **Client** wählen und den
   nativen Dienst starten. Die Rolle beschreibt diese konkrete Verbindung.
   Ein gespeicherter Wunsch allein macht keinen Rechner zum aktiven Server.
5. **Verbunden** erscheint erst nach gegenseitigem TLS 1.3, exaktem
   Geräteschlüssel-Pinning, aktueller Kontoprüfung und einem gültigen Heartbeat.
   Ohne frische Bestätigung verfällt der Status auch bei stockender UI-Abfrage.
6. **Trennen** beendet den eigenen Dienst und verwirft die Lease. Temporäre
   Netzfehler führen zu begrenztem Wiederverbinden. Ein anderer Owner,
   Schlüsselwiderruf oder fehlerhafte Signatur beendet die Berechtigung.

Der native Dienst verwendet ausschließlich die verifizierte private
Tailscale-Adresse und Port 49284. Hostname, Account-Zugehörigkeit oder ein
Cloud-Heartbeat ersetzen den kryptografischen Peer-Nachweis nicht.

## Remote MCP ist eine getrennte Freigabe

**Aktueller Stand:** Die produktive Providerfreigabe steht weiterhin aus.
Die nachfolgenden nativen Mesh-Gerätetests ersetzen diese Freigabe nicht.
Die historische lesende Supabase-Migrationsabfrage am 18. November um **17:05 Uhr MEZ**
zeigte weiterhin `20261117172610` als letzten angewendeten Stand. Keine
der damals drei Beta4-Migrationen war angewendet. Dieser historische Stand
ist inzwischen teilweise fortgeschritten: Die tatsächliche Leseprüfung am
18. November um **19:50 UTC** bestätigt `beta4_private_owner_runtime`
(`20261118185351`) und `beta4_native_owner_mfa_bridge` (`20261118185500`).
Die Ausführung der dritten Migration wurde abgebrochen und nicht erneut
gestartet; Geräte-Consent- und Git-Scope-Migration fehlen. Client-Grants und
Geräte-Consents sind weiterhin **0**. Es wurde kein Gerätezugriff erteilt.

Der bestätigte Owner besitzt noch keinen verifizierten TOTP-Faktor. Zusätzlich
fehlt eine nach dem bestehenden Produktvertrag gültige Remote-MCP-Freigabe;
eine ältere Business-Statusanzeige allein erfüllt diesen Vertrag nicht.
Weder ein Ablaufdatum noch eine Genehmigung wurde dafür erfunden. Der aktuelle
Worker bleibt beim authentifizierten synthetischen Ping. Neue unabhängige
Signer sind auf dem Operator-Gerät vorbereitet; nur ihre öffentlichen Pins
sind im Desktop-/Connector-Quellcode enthalten. Provider-Secrets und Deployment
sind damit noch nicht erfolgt.

Die registrierte ChatGPT-Verbindung stellt zunächst eine authentifizierte
MCP-Verbindung her. Der bisherige synthetische Ping allein beweist weder
Gerätezugriff noch ein verbundenes Mesh.

Die neue native Freigabe bindet den angemeldeten Owner, die konkrete
ChatGPT-OAuth-Anwendung, den Grant und eine frische MFA-Bestätigung.
Die native Sitzung ist der handelnde Owner; sie wird nicht in die Identität
der Zielanwendung umgeschrieben. Intent-Nonce, Auth-Challenge und Token
verlassen den nativen Prozess nicht. Einmalige Entscheidungen werden
transaktional geprüft und signiert protokolliert.

Die ausgehende WSS-Verbindung verwendet ein einmaliges kurzlebiges Ticket,
einen unabhängig eingebauten Ed25519-Server-Pin und den bestehenden
Keychain-Geräteschlüssel. Jede Präsenzbestätigung wird signiert und neu gegen
die aktuelle Serverautorität geprüft. Tickets, Schlüsselstand und Freigaben
werden regelmäßig neu zugelassen. Im reinen Präsenzmodus werden keine
Remote-Shell-, Datei- oder Git-Aufträge registriert. Der neue Git-Lesevertrag
benötigt die separat dokumentierte Clientfreigabe und lokale Projektauswahl.

## Was der Integrationsstand ergänzt

| Bereich | Implementierung | Aktueller Abnahmebeleg und verbleibende Grenze |
|---|---|---|
| Geräte-UI | Frische Kontoliste, Auswahl, historische Registrierungen, Rollenwahl, native Zustandsanzeige | Candidate 3 auf M3: manuelles Verbinden ohne 120-Sekunden-Wartezeit, sechs App-Registrierungen, vorhandene Peer-Auswahl, Serverstart, frische Live-Anzeige, Wartezustand nach Client-Ende und UI-Stop geprüft. |
| Mesh-Dienst | Tatsächlicher mTLS-Socket, Heartbeat-Lease, Reconnect, Stop, Owner-Wechsel | Candidate 3: M3-GUI-Server und M2-Client mit sechs bestätigten Heartbeats, Client-Exit 0 und beidseitigem Stop-Nachweis. Candidate-2-Reconnect und die frühere b754-Abnahme einschließlich Server-Exit 5 bleiben separat dokumentiert. |
| Sitzung | Serialisierte Tokenrotation, MFA, Logout-Sperre und Generation-Fencing | Native Tests und Logout während laufender Operation |
| MCP-Freigabe | Owner-/Ziel-Client-Trennung, frische MFA, einmalige geprüfte Entscheidung | Offen: echte Owner-Bestätigung; keine vorbereiteten Approved-Datensätze |
| MCP-Präsenz | Gepinnte signierte Challenge/ACK, kurzlebige WSS-Sitzung, Widerrufsprüfung | Offen: produktiver Worker, echte DB-Rollen und echtes freigegebenes Gerät |
| Verpackung | Eigener signierter/notarisierter Kandidat mit geprüftem Ressourcenbestand | Candidate 3: Developer-ID-Signatur, Apple Accepted, Staple, codesign und spctl bestanden; dasselbe Paket auf M2 und M3 verifiziert. Die früheren geprüften Pakete bleiben als Fallback erhalten. |

## Verifikation: Stand der Integration

Die konkreten Ausführungsbelege gelten jeweils für den genannten Quellstand
und das geprüfte Paket. Vorherige Stage4U/Stage4AA-Pairing- und TLS-Nachweise
bleiben historische Belege; sie ersetzen nicht den Test dieses neuen Builds.

- Historischer vollständiger Node-Lauf bei Commit
  `2d9e4126b7123ce87c946284f0287fbddf05ec77`: **975/975 bestanden**,
  keine übersprungenen Tests (18.11.2026). TypeScript und Vite-Produktionsbuild
  bestanden ebenfalls an dieser Baseline. **Dieser Node-Count ist kein
  Nachweis für b754 oder den nachfolgend geänderten Arbeitsbaum.**
- Frühere Läufe fanden veraltete Quellenannahmen und zu kurze Prozess-
  Startfristen unter paralleler Mac-Last. Die Annahmen wurden an das neue
  Verhalten angepasst; negative Sicherheitsprüfungen bleiben bestehen.
- Connector: tatsächliche PostgreSQL-17-Prüfung mit nachgebildeten Managed-
  Supabase-Rollen bestanden, einschließlich nativer Client-MFA, signiertem
  Audit, Replay-Abweisung, Widerruf und weiterhin erlaubter Geräteerkennung.
  Der WSS-Server bestand 23 Node- und 6 echte Workerd-/SQLite-/Sockettests.
- Commit `c93a0ab697b07571ec3c5ac1862848ea7e516b08`: Der Workflow
  [Beta4 Native macOS Library Tests](https://github.com/NMKato/KatoSync/actions/runs/44294689069)
  hat die tatsächliche Stage4J-Bibliothek auf `macos-15` kompiliert und getestet:
  **479 bestanden, 0 fehlgeschlagen, 8 bewusst ignorierte manuelle Live-Tests**.
  TypeScript und der Vite-Produktionsbuild bestanden im selben Lauf.
- Commit `b754d170`: Genau ein öffentlicher PR-Lauf
  [44319035816](https://github.com/NMKato/KatoSync/actions/runs/44319035816)
  baute die Desktop-App erfolgreich auf einem Standard-ARM64-Runner:
  **479 Tests bestanden, 8 ignoriert**, Gesamtjobzeit **3:14 Minuten**,
  Tauri-Build **1:15 Minuten**, vorhandener Build-Cache genutzt.
- Der heruntergeladene `b754d170`-Build wurde unabhängig anhand des ZIPs,
  der SHA-Prüfsummen, des Build-Receipts und des Mach-O-Formats geprüft.
  Danach bestanden lokale **Developer-ID-Signatur**, Apple-Notarisierung
  mit Status **Accepted**, `stapler` und `spctl`. Dasselbe signierte Paket
  wurde anschließend auf M2 Pro und M3 verifiziert. Die früheren
  funktionierenden Pakete bleiben als Fallback erhalten.
- Die b754-App wurde auf beiden Macs als GUI gestartet. Auf M3 sind
  Workspacewahl, Agent-Sync-Dashboard und die Verbindungsseite korrekt
  sichtbar gerendert. Der native Mesh-Klickpfad bleibt in Prüfung. Der Einstieg
  zur Verbindung liegt im Standardfenster noch hinter Sidebar-Scrolling,
  die Mesh-Karte hinter anderen Providern. Auf M2 scheiterte die Pixelaufnahme;
  damit liegt **kein vollständiger Visual-PASS und keine vollständige
  Mesh-Klickpfad-Abnahme** vor.
- Produktive DB-Migration, Worker-Freischaltung und echte MFA-/Gerätefreigabe
  sind noch nicht als abgeschlossen protokolliert.
- Der Abhängigkeitsaudit bleibt ein eigener erforderlicher CI-Gate. Der
  Candidate-3-CI-Audit und die lokale Antwort mit fünf hohen Befunden sind
  **historische rote Ergebnisse**. Der spätere frische Registry-Audit um
  **17:52 UTC** bestand mit **Exit 0 und null Befunden**. Der
  [separate Nachweis](KATOSYNC_BETA4_DEPENDENCY_AUDIT_20261118.md) ersetzt
  keinen abschließenden CI-Lauf des neuen Release-Quellstands.

### Signierte Paketidentität des physisch getesteten b754-Builds

Die folgenden SHA-256-Werte gehören zum signierten, notarisierten
`b754d170`-Kandidaten. Sie kennzeichnen keine spätere Quellcodeänderung.

| Artefakt | SHA-256 |
|---|---|
| ZIP der App mit angeheftetem Notarisierungsticket | `31403ace43947f2ea1b1b2db4346c67e86b62b9f334ddff13fb3343b2942021d` |
| Signierte Mach-O-App-Binärdatei | `5b8f119ad7abf75e8dfe3370d55560b5a574d50548d49dae3eb99f915538d709` |

### Physischer Mesh-Test mit demselben b754-Paket

Der M2 Pro lief als Server mit einem 300-Sekunden-Testfenster. Der M3
verband sich zweimal nacheinander als Client für jeweils 60 Sekunden.
Zwischen den Clientläufen blieb **derselbe M2-Serverprozess** bestehen.

| Ausführung | Beobachtung | Ergebnis |
|---|---|---|
| M3-Client, erster Lauf | 8 echte Heartbeats, abschließender Live-Status und Stop bestätigt | Exit 0 / PASS |
| M3-Client, zweiter Lauf | 9 echte Heartbeats, abschließender Live-Status und Stop bestätigt | Exit 0 / PASS |
| M2-Server, dasselbe 300-Sekunden-Fenster | `connected → reconnecting → listening → connected`, insgesamt 18 Heartbeats, abschließender Stop bestätigt | Reconnect im selben Prozess belegt; am Ende kein Client mehr anwesend, daher Exit 5 / `SMOKE_ENDED_WITHOUT_LIVE_CHANNEL` |

**Der Server-Gesamtlauf erhält keinen PASS.** Der abschließende
Live-Kanal-Nachweis fehlte nach dem Ende der Clientläufe; die Abnahmebedingung
wurde nicht abgeschwächt. Die erfolgreichen Clientläufe und der beobachtete
Server-Reconnect bleiben die konkret belegten Ergebnisse. Es wurden keine
Remote-Jobs ausgeführt oder daraus neue Ausführungsrechte abgeleitet.

### Candidate 2: nativer Build, signiertes Paket und echter GUI-/Mesh-Lauf

Der genaue Quellstand des zweiten Kandidaten ist
`232822fb3ac50f51e08ab3a884d1fa4184337602`. Er enthält den engen Rust-Fix,
die UI-Änderungen in `App.tsx` und `ProviderManager` sowie die korrigierte
Radio-CSS-Regel. Der öffentliche
[CI-Lauf 44327673503](https://github.com/NMKato/KatoSync/actions/runs/44327673503),
[Job 134883261989](https://github.com/NMKato/KatoSync/actions/runs/44327673503/job/134883261989),
bestand mit **482 bestandenen nativen Tests, 0 Fehlern und 8 ignorierten Tests**.
TypeScript und Vite bestanden einschließlich der Radio-CSS-Korrektur.
Der tatsächliche Tauri-App-Build dauerte **85 Sekunden**, der gesamte Job
**217 Sekunden**.

Das CI-Artefakt trägt die ID `14438505940`. Die folgenden im CI gemeldeten
SHA-256-Werte gehören zum Paket **vor einer lokalen Developer-ID-Signierung**:

| CI-Artefakt | SHA-256 |
|---|---|
| GitHub-Artefakt-ZIP | `2929373d906d6402599980cba55e75e3d726bff4ed7c795fc06aa167538edf35` |
| App-Binärdatei | `0de5db2468b9b034abec627292cf934dbcdfae2eeb088b5947f8d3abbd081ca7` |

Der lokale Signier-/Notarisierungslauf endete nach **288,50 Sekunden mit
Exit 0**. Apple meldete **Accepted**; das Notarisierungsticket wurde
angeheftet. `codesign`, `stapler` und `spctl` bestanden auf M2 und M3.
Dasselbe Paket wurde auf beiden Macs als **KatoSync Beta4 Candidate 2.app**
installiert. Die signierten Paket- und Geräteergebnisse von b754 bleiben
getrennte historische Nachweise.

| Signiertes Candidate-2-Artefakt | SHA-256 |
|---|---|
| Zur Notarisierung eingereichtes ZIP | `9a6803a2a677ba0b1cdf7b8b6dd4d364dd15d756d1d05865aa58747dcae0df1e` |
| ZIP mit angeheftetem Notarisierungsticket, 53.974.396 Bytes | `8b0c7e446a13c6749277ea76e461598e3afcaf29f63055bf5cfe7133a77fe8b7` |
| Signierte App-Binärdatei | `3780bc4303694e9d63b4c0d148547a2ea5132a6fe32a3c79bdcf8c608daf0c46` |

#### Native M3-GUI und zwei M2-Clientläufe

Auf M3 wurde die native Candidate-2-App gestartet. Der Verbindungseintrag
an zweiter Navigationsposition, die Mesh-Karte am Anfang und die korrigierten
Rollen-Radiobuttons wurden sichtbar geprüft. Die Kontoansicht zeigte
**sechs App-Registrierungen: die eigene und fünf weitere Registrierungen**.
Das ist keine Zählung von sechs physischen Computern.

In der GUI wurde der vorhandene, bereits gepinnte M2-Peer ausgewählt,
M3 als **Server** eingestellt und der native Server gestartet. Der M2
verband sich anschließend zweimal über denselben nativen CLI-Dienst.
Die Startzeiten am 18. November 2026 verwenden Europe/Berlin (MEZ, UTC+1).

| M2-Clientlauf | Start | Gesamtdauer | Beobachtete Heartbeats | Ergebnis |
|---|---|---:|---:|---|
| Erster Lauf | 16:15:38 Uhr | 63,99 Sekunden | 6 | `STOP_CONFIRMED`, `RUNTIME_PASS_NO_REMOTE_JOBS`, Exit 0 |
| Zweiter Lauf | 16:18:32 Uhr | 65,67 Sekunden | 3 | Erkennung → Verbindungsaufbau → Wiederverbinden → erneute Erkennung → Verbindungsaufbau → verbunden; `STOP_CONFIRMED`, `RUNTIME_PASS`, Exit 0 |

Während der ersten Live-Verbindung zeigte die M3-GUI **„Sicher verbunden“**.
Nach dem Ende der Gegenstelle erschien **„Server wartet“**. Der abschließende
UI-Stop führte zu **„Bereit zum Verbinden“**; `lsof` bestätigte, dass derselbe
GUI-Prozess danach keinen Listener auf Port 49284 mehr hielt. Für die
Wiederverbindung im zweiten Lauf stammt der Kanalnachweis aus dem nativen
Runtime-PASS; ein zweiter grüner Screenshot dieser Wiederverbindung liegt
nicht vor. Es wurden **keine Remote-Jobs ausgeführt und keine neuen Pins
angelegt**.

Der Rust-Fix erhält bei der erneuten Authority-Prüfung im
Server-Heartbeat ausschließlich den bereits typisiert klassifizierten Fehler
`MESH_ADMISSION_AUTHORITY_UNAVAILABLE` als wiederholbar. Andere
Berechtigungsfehler bleiben terminal und erzeugen kein ACK. Die Korrektur
ist im erfolgreich getesteten nativen Candidate-2-Build enthalten; sie
gehört nicht zur zuvor physisch getesteten b754-Binärdatei.

Die zusätzliche UI-Korrektur ordnet den Verbindungseintrag (`agentProviders`)
direkt nach dem Dashboard und die Mesh-/MCP-Karten an den Anfang. Diese
Anordnung ist jetzt am nativen Candidate-2-Fenster auf M3 sichtbar geprüft.
Die früheren M3-Prüfungen von Workspacewahl, Dashboard und Verbindungsseite
unter b754 bleiben davon getrennt.

Ein historischer AB1-Source-Contract wurde fachlich an die seit `c93a0ab`
vorhandene crate-interne `LiveTlsLease`-Brücke angepasst. Das bisherige
pauschale Verbot auch von `pub(crate) fn` erzeugte dort einen Falschalarm.
Die Verbote von direktem Tauri-IPC, öffentlichen `pub fn` und Transportzugriffen
bleiben erhalten. Die vollständige vorhandene Node-Suite einschließlich
des ergänzend ausgeführten AB1-MJS-Vertrags bestand anschließend mit
**984/984 Tests, 0 Fehlern und 0 übersprungenen Tests**, Exit 0.
Der Lauf dauerte am 18.11.2026 von 15:36:52 bis 15:39:06 Uhr MEZ;
TAP-Dauer 130,318 Sekunden, npm-Prozess 134,04 Sekunden. Die SHA-256-Werte
der fünf zu diesem Zeitpunkt geänderten Code-/Testeingaben blieben
vor und nach dem Lauf identisch.

Danach wurde anhand eines tatsächlichen M3-Screenshots die globale
Textfeldbreite für die Rollen-Radiobuttons korrigiert: Der eng begrenzte
Radio-Selektor verwendet nun 18-Pixel-Abmessungen statt `width: 100%`.
Diese einzelne CSS-Regel wurde nach dem genannten Node-Lauf geändert.
Ihr TypeScript-/Vite- und nativer Paketbau sind durch den oben genannten
exakten Candidate-2-Lauf belegt; die Rollen-Radiobuttons wurden anschließend
am neuen M3-Paket sichtbar geprüft. Der frühere Node-Count wird nicht als neuer vollständiger Node-Lauf
nach dieser CSS-Änderung ausgegeben.

#### Bootstrap-Race in Candidate 2 und nachfolgender Fix

In der installierten `232822fb`-App kann eine manuelle erste Rosterabfrage
den noch laufenden Hintergrund-Bootstrap überholen. Ein separater lokaler
Patch startet nach erfolgreicher aktueller Vordergrundabfrage den bestehenden
geprüften Bootstrap-Effekt erneut; Owner-, Epoch- und Identitätsprüfungen
bleiben erhalten. Dafür bestanden **sechs gezielte Regressionstests**.
Nach Übernahme bestand auf dem M2 zusätzlich die gezielte Prüfung aller
Testdateien, die diese Komponente referenzieren: **180/180 bestanden,
0 Fehler, 0 übersprungen**, TAP-Laufzeit **20,40 Sekunden**.
Dieser spätere Patch ist **nicht Bestandteil des oben signierten und physisch
geprüften Candidate-2-Pakets**. Candidate 3 enthält ihn und besitzt die unten
aufgeführten eigenen Build-/Testbelege; die Candidate-2-Geräteergebnisse
werden ihm nicht zugerechnet.

Produktive DB-Migration, Cloudflare-Worker-Freischaltung, echte MFA- und
Gerätefreigabe sowie der reale MCP-Gerätezugriff bleiben separate offene
Gates; der Dependency-Audit war zum damaligen Candidate-2-Zeitpunkt rot
(historisch; späterer [Audit-PASS](KATOSYNC_BETA4_DEPENDENCY_AUDIT_20261118.md)). Auch das signierte,
notarisierte und getestete Candidate-2-Paket ist damit keine vollständige
4.0- oder Remote-MCP-Freigabe.

### Candidate 3: Bootstrap-Fix, native CI und signiertes Paket

Der genaue Quellstand ist `0c85c5d010eef779b998be852e985dc7ffbac28e`.
Alle lesbaren Uhrzeiten in diesem Abschnitt verwenden Europe/Berlin
(MEZ, UTC+1); rohe API-Zeitstempel bleiben unverändert.

| Nachweis am 18. November 2026 | Ergebnis |
|---|---|
| [Nativer CI-Lauf 44336643584](https://github.com/NMKato/KatoSync/actions/runs/44336643584), [Job 134915085698](https://github.com/NMKato/KatoSync/actions/runs/44336643584/job/134915085698) | PASS, 16:31:44–16:35:19 Uhr, **215 Sekunden** Gesamtjobzeit |
| Native Tests | **482 bestanden, 0 fehlgeschlagen, 8 ignoriert**, Laufzeit **11,25 Sekunden** |
| TypeScript / Vite | PASS; gemeldete Vite-Buildzeit **1,46 Sekunden** |
| Tatsächlicher Tauri-/Cargo-App-Build | PASS, **75 Sekunden** |
| [Fast Gate 44336630777](https://github.com/NMKato/KatoSync/actions/runs/44336630777): Linux Node | **986/986 bestanden**, **13,198 Sekunden** |
| Windows Node | **986 bestanden**, **14,581 Sekunden** |
| Bootstrap-Regressionen | Alle **sechs** bestanden |
| Weitere CI-Prüfungen | Rustfmt und Deno bestanden |

Das CI-Artefakt trägt die ID `14441423050` und die gemeldete Größe
**26.116.062 Bytes**. Seine Werte vor der lokalen Developer-ID-Signierung:

| CI-Artefakt | SHA-256 |
|---|---|
| GitHub-Artefakt-ZIP | `50686dd298a20a20e514b582ea8bf686e0f450a8639b45173e8fe949bcf79f9a` |
| App-Binärdatei | `c73e7a15a00c1db7e746e3536b4b3cff8df894dbf5f97228c9051918937a3a97` |

Der lokale Signier-/Notarisierungslauf endete nach **304,76 Sekunden mit
Exit 0**. Apple meldete **Accepted**; `stapler`, die strenge rekursive
`codesign`-Prüfung und `spctl` bestanden. Anschließend wurde dasselbe Paket
auf M3 übertragen und dort anhand von Hash, Signatur, Staple und Gatekeeper
geprüft. Die Übertragung endete nach **61,17 Sekunden mit Exit 0**; der
temporäre Transfer-Listener wurde geschlossen.

| Signiertes Candidate-3-Artefakt | SHA-256 |
|---|---|
| Zur Notarisierung eingereichtes ZIP | `f764c4c389b4c9b16ed25a543a656be39a5248af70e3e444901a2616fbc58a10` |
| ZIP mit angeheftetem Notarisierungsticket, 53.974.449 Bytes | `12daef86020527a26bf9d448c7d8d2edbc48e23ac90cb31d7ea810263b6153dd` |
| Signierte App-Binärdatei | `e03a8bc3cf5a342c82037f3c3cc654743665a7477c44db5906a4fc52e97bde11` |

Auf M3 wurde die vorherige GUI kontrolliert beendet und **KatoSync Beta4
Candidate 3.app** gestartet. Die Anmeldung blieb erhalten; Agent Sync und
der Verbindungseintrag an zweiter Navigationsposition sind sichtbar.
Auf beiden Macs wurde die zuvor nicht vorhandene sichtbare Verknüpfung
`~/Applications/KatoSync Beta4.app` auf den geprüften Candidate 3 angelegt.
Ziel-Commit und signierter Binärdatei-Hash wurden vorher geprüft; keine
bestehende App wurde überschrieben.

#### Candidate-3-GUI: Verbinden, frischer Kanal und bestätigtes Trennen

Der manuelle Weg **Verbindungen → Verbinden** stellte die Kontoliste und
den Bootstrap ohne die zuvor mögliche 120-Sekunden-Wartezeit bereit.
Angezeigt wurden sechs App-Registrierungen, die eigene und fünf weitere;
daraus wird keine Anzahl physischer Computer abgeleitet. Die Server-Rolle
war über den korrekt dargestellten 18-Pixel-Radiobutton auswählbar. Der
bereits gepinnte M2-Peer wurde ausgewählt und **„Als Server bereitstellen“**
gestartet. Es erfolgte keine neue Kopplung oder Schlüsselerzeugung.
Die physischen Durchläufe nutzten bereits gekoppelte Geräte. Der Ablauf
einer **frischen Anfrage und Annahme** ist dadurch nicht zusätzlich belegt.

Der M2-Client verwendete dieselbe signierte Binärdatei aus exakt
`0c85c5d010eef779b998be852e985dc7ffbac28e`:

| Physischer Lauf am 18. November 2026 | Ergebnis |
|---|---|
| M2-Client, Beginn | **16:59:50 Uhr MEZ**, vorgesehenes 60-Sekunden-Testfenster |
| Gesamtlaufzeit | **64,85 Sekunden** |
| Zustände | Erkennung → Verbindungsaufbau → verbunden |
| Kanalbeleg | **Sechs bestätigte Heartbeats** |
| Abschluss | `MESH_BETA_STOP_CONFIRMED`, `MESH_BETA_RUNTIME_PASS_NO_REMOTE_JOBS`, **Exit 0** |

Während der Client tatsächlich verbunden war, zeigte die native M3-GUI
**„Sicher verbunden“** in Kopfzeile, Netzwerkanzeige und Runtime-Bereich.
Nach dem Client-Ende wechselte sie automatisch zu **„Gekoppelt (lokal)“**,
**„Noch nicht aktiv“** und **„Server wartet auf das andere Gerät“**.
Damit blieb kein falsches grünes Live-Signal stehen.

Anschließend wurde in derselben M3-GUI **„Trennen / Versuch beenden“**
gewählt. Die Aufnahme um **17:02 Uhr MEZ** zeigt **„Bereit zum Verbinden“**,
wieder bedienbare Rollenwahl und den erhaltenen ausgewählten M2-Peer.
Die unabhängige Listener-Abfrage für denselben GUI-Prozess fand danach
keinen TCP-Listener auf Port 49284. Die App bleibt geöffnet und inaktiv.
Es wurden keine Remote-Jobs ausgeführt, keine neuen Pins angelegt und
keine alten funktionierenden Bundles entfernt.

Die sechs automatisierten Bootstrap-Regressionen prüfen die Race gezielt.
Die native GUI-Abnahme belegt den funktionierenden manuellen Bedienweg;
sie wird **nicht als garantierte Provokation derselben exakten
Race-Reihenfolge** ausgegeben. Die physischen Candidate-2-Ergebnisse
bleiben separat erhalten.

### Historisch: Picomatch-Rücknahme und zunächst weiterhin roter Audit

**Aktualisierung:** Der unten erhaltene frühe Prüfstand wurde durch den
[frischen Registry-Audit um 17:52 UTC](KATOSYNC_BETA4_DEPENDENCY_AUDIT_20261118.md)
ergänzt: **Exit 0, null Befunde** auf Linux und M3 bei unverändertem Lockfile.
Die alten CI-Ergebnisse werden dadurch nicht rückwirkend grün.

Der historische
[Candidate-3-Auditjob 134914998751](https://github.com/NMKato/KatoSync/actions/runs/44336630777/job/134914998751)
meldete fünf hohe Abhängigkeitsbefunde im Picomatch-Pfad und blieb rot.
Ein späterer Check bestätigt für
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
die GitHub-Rücknahme: `withdrawn_at=2026-11-18T15:38:56Z`, entsprechend
**16:38:56 Uhr MEZ**; der API-Titel beginnt nun mit „Withdrawn Advisory“.

Genau ein anschließender lokaler `npm audit --json` auf unverändertem
Commit `0c85c5d0` lief von **16:56:01 bis 16:56:16 Uhr MEZ**. Er endete
weiterhin mit **Exit 1, fünf hohen Befunden, null kritischen Befunden**.
Betroffen waren laut dieser Audit-Antwort `picomatch` sowie die abhängigen
Pakete `fdir`, `tinyglobby`, `vite` und `@vitejs/plugin-react`; der direkte
Hinweis verwies weiterhin auf dasselbe GHSA. Commit, `package.json`,
`package-lock.json` und sauberer Arbeitsbaum blieben unverändert.

Die Rücknahme ist eine bestätigte Upstream-Änderung; sie ist hier **kein
behaupteter Paket-Fix und kein Audit-/Freigabe-PASS**. Der historische rote
CI-Lauf wird nicht rückwirkend als erfolgreich markiert. Für diesen frühen
Nachweis erfolgte kein CI-Rerun. Die spätere frische Audit-Abfrage ist im
oben verlinkten separaten Protokoll dokumentiert.

## CI-Ausführung und Kosten

KatoSync ist zum Prüfzeitpunkt ein öffentliches Repository. Die verwendeten
Standardrunner `ubuntu-latest`, `windows-latest` und `macos-15` sind deshalb
[compute-kostenfrei und verbrauchen kein inkludiertes Compute-Kontingent](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Runner-Laufzeit ist hier nicht mit einer tatsächlichen Kontingentabbuchung
gleichzusetzen; Speicher wird getrennt betrachtet.

Derselbe Commit `c93a0ab` wurde durch `push` und `pull_request` doppelt im
Beta4-Mac-Workflow geprüft: [Push-Lauf](https://github.com/NMKato/KatoSync/actions/runs/44294689069)
mit 4:55 Minuten und [PR-Lauf](https://github.com/NMKato/KatoSync/actions/runs/44294697659)
mit 5:08 Minuten Joblaufzeit. Der nachfolgende App-Build von `b754d170`
lief in genau einem erfolgreichen PR-Lauf mit 3:14 Minuten Gesamtjobzeit.
`pull_request` mit bestehenden Pfadfiltern und `workflow_dispatch`, Jobname,
Pflichtprüfungen und Testumfang bleiben erhalten.

## Reproduzierbare Entwicklung und Paketbau

```bash
npm ci --ignore-scripts
npm test
npm run build
cargo check --locked --manifest-path src-tauri/Cargo.toml --features stage4j-qa
cargo test --locked --manifest-path src-tauri/Cargo.toml --features stage4j-qa --lib
```

Der Build benötigt ein erzeugtes `dist/`, die echten geprüften
Typst-/Poppler-/STT-Ressourcen, einen sauberen überprüften Commit,
eine bestehende Developer-ID und ein bestehendes Notarisierungsprofil.
`scripts/build-beta4-macos.sh` prüft diese Voraussetzungen und erzeugt
einen neuen App-Pfad. Das bekannte funktionierende Paket wird erhalten.

Für den Test ohne UI verwendet die signierte Anwendung denselben Dienst:

```bash
katosync --mesh-beta-session server paired 90
katosync --mesh-beta-session client paired 90
```

`paired` ist nur bei genau einem lokal bestätigten Peer zulässig. Ein positiver
Lauf verlangt mehrere echte Heartbeats, einen am Ende noch gültigen Status
und anschließend einen bestätigten Stop. Er erlaubt keine Remote-Jobs.

## Noch getrennt abzunehmende 4.0-Ziele

Agent Birth, Modell-/Runtime-Lizenzierung, dauerhafte Persona/Memory,
Desktop-Widget und vollständiges
Orchestrieren von Aufgaben, schreibende Remote-Jobs, Single-Writer-Lease,
Billing, Windows-Installer und Barrierefreiheit besitzen eigene Release-Gates.
Die signierten Mesh-Kandidaten erfüllen diese Gesamtziele nicht automatisch.
Produktive DB-/Worker-Freischaltung, echte Owner-MFA, Gerätefreigabe und
produktiver MCP-Gerätezugriff bleiben ebenfalls getrennt abzunehmen.
Die Roadmap-Tabelle vom 4. November ist ausdrücklich historisch; ihr
Abgleich vom 18. November verweist für aktuelle Paket-/Gerätenachweise auf
dieses Protokoll. Es werden keine vollständigen 4.0-Gates allein aufgrund
der neuen Mesh-CI- oder Signaturergebnisse abgehakt. Maßgeblich ist die
[4.0-Roadmap](KATOSYNC_4_0_AGENT_BIRTH_RELEASE_ROADMAP_2026-11-04.md).
