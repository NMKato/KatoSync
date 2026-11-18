# KatoSync 4.0: private Beta-Integration vom 18. November 2026

## Zweck und Umfang

Dieser Entwicklungszweig verbindet die bereits vorhandene Kontoanmeldung,
Geräteregistrierung und SAS-Kopplung mit einem tatsächlich gestarteten nativen
Mesh-Dienst und der getrennten Remote-MCP-Freigabe. Die Produktbezeichnung 4.0
ist das Integrationsziel. Die Paketversion 2.0.0 und bestehende signierte
QA-Installationen sind damit nicht rückwirkend ein veröffentlichtes 4.0-Release.

Desktop: `beta/4.0-integration-20261118`.
Connector: `beta/4.0-runtime-integration-20261118` im Repository
[NMKato/KatoSync-Remote-MCP](https://github.com/NMKato/KatoSync-Remote-MCP/tree/beta/4.0-runtime-integration-20261118).

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
werden regelmäßig neu zugelassen. Die Präsenzverbindung registriert noch
keine Remote-Shell-, Datei- oder Git-Ausführung.

## Was der Integrationsstand ergänzt

| Bereich | Implementierung | Aktueller Abnahmebeleg und verbleibende Grenze |
|---|---|---|
| Geräte-UI | Frische Kontoliste, Auswahl, historische Registrierungen, Rollenwahl, native Zustandsanzeige | Candidate 2 auf M3: Navigation, Mesh-Karte, Radiobuttons, vorhandene Peer-Auswahl, Serverstart, Live-Anzeige und UI-Stop geprüft. Der spätere Bootstrap-Race-Fix ist noch nicht in der installierten App enthalten. |
| Mesh-Dienst | Tatsächlicher mTLS-Socket, Heartbeat-Lease, Reconnect, Stop, Owner-Wechsel | Candidate 2: M3-GUI-Server und zwei M2-Clientläufe mit 6/3 beobachteten Heartbeats, Exit 0 und Stop; Wiederverbindung im zweiten Lauf. Die frühere b754-Abnahme einschließlich Server-Exit 5 bleibt separat dokumentiert. |
| Sitzung | Serialisierte Tokenrotation, MFA, Logout-Sperre und Generation-Fencing | Native Tests und Logout während laufender Operation |
| MCP-Freigabe | Owner-/Ziel-Client-Trennung, frische MFA, einmalige geprüfte Entscheidung | Echte Owner-Bestätigung; keine vorbereiteten Approved-Datensätze |
| MCP-Präsenz | Gepinnte signierte Challenge/ACK, kurzlebige WSS-Sitzung, Widerrufsprüfung | Produktiver Worker, echte DB-Rollen und echtes freigegebenes Gerät |
| Verpackung | Eigener signierter/notarisierter Kandidat mit geprüftem Ressourcenbestand | Candidate 2: Developer-ID-Signatur, Apple Accepted, Staple, codesign und spctl bestanden; dasselbe signierte Paket auf M2 und M3 geprüft und installiert. Bestehende Fallbacks bleiben erhalten. |

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
- Der Abhängigkeitsaudit bleibt **rot** und ein eigener erforderlicher CI-Gate. Der
  bekannte Picomatch-Befund wird nicht durch Deaktivieren des Audits übergangen.

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

#### Bekannte Bootstrap-Race: späterer lokaler Fix

In der installierten `232822fb`-App kann eine manuelle erste Rosterabfrage
den noch laufenden Hintergrund-Bootstrap überholen. Ein separater lokaler
Patch startet nach erfolgreicher aktueller Vordergrundabfrage den bestehenden
geprüften Bootstrap-Effekt erneut; Owner-, Epoch- und Identitätsprüfungen
bleiben erhalten. Dafür bestanden **sechs gezielte Regressionstests**.
Nach Übernahme bestand auf dem M2 zusätzlich die gezielte Prüfung aller
Testdateien, die diese Komponente referenzieren: **180/180 bestanden,
0 Fehler, 0 übersprungen**, TAP-Laufzeit **20,40 Sekunden**.
Dieser spätere Patch ist **noch nicht Bestandteil des hier signierten und
physisch geprüften Pakets**. Er benötigt einen eigenen nativen Build und
Gerätenachweis; die Candidate-2-Ergebnisse werden ihm nicht zugerechnet.

Produktive DB-Migration, Cloudflare-Worker-Freischaltung, echte MFA- und
Gerätefreigabe sowie der reale MCP-Gerätezugriff bleiben separate offene
Gates; der erforderliche Dependency-Audit bleibt rot. Auch das signierte,
notarisierte und getestete Candidate-2-Paket ist damit keine vollständige
4.0- oder Remote-MCP-Freigabe.

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

Agent Birth, Modell-/Runtime-Lizenzierung, dauerhafte Persona, vollständiges
Orchestrieren von Aufgaben, schreibende Remote-Jobs, Single-Writer-Lease,
Billing und Windows-Installer besitzen eigene Release-Gates. Der erste
eigene Mesh-Test schließt diese Gates nicht. Maßgeblich ist die
[4.0-Roadmap](KATOSYNC_4_0_AGENT_BIRTH_RELEASE_ROADMAP_2026-11-04.md).
