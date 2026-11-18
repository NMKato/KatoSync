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
| Geräte-UI | Frische Kontoliste, Auswahl, historische Registrierungen, Rollenwahl, native Zustandsanzeige | b754-App auf beiden Macs gestartet; auf M3 Workspacewahl, Agent-Sync-Dashboard und Verbindungsseite sichtbar geprüft. Vollständiger nativer Mesh-Klickpfad offen; M2-Pixelaufnahme fehlgeschlagen. |
| Mesh-Dienst | Tatsächlicher mTLS-Socket, Heartbeat-Lease, Reconnect, Stop, Owner-Wechsel | Derselbe signierte `b754d170`-Build auf M2 Pro und M3; zwei Clientläufe mit 8/9 Heartbeats und Stop bestanden. Server-Reconnect beobachtet, aber kein Server-Gesamt-PASS. |
| Sitzung | Serialisierte Tokenrotation, MFA, Logout-Sperre und Generation-Fencing | Native Tests und Logout während laufender Operation |
| MCP-Freigabe | Owner-/Ziel-Client-Trennung, frische MFA, einmalige geprüfte Entscheidung | Echte Owner-Bestätigung; keine vorbereiteten Approved-Datensätze |
| MCP-Präsenz | Gepinnte signierte Challenge/ACK, kurzlebige WSS-Sitzung, Widerrufsprüfung | Produktiver Worker, echte DB-Rollen und echtes freigegebenes Gerät |
| Verpackung | Eigener signierter/notarisierter Kandidat mit geprüftem Ressourcenbestand | Developer-ID-Signatur, Apple-Notarisierung, Staple und Gatekeeper bestanden; identisches Paket auf beiden Geräten verifiziert und gestartet. Bestehende Fallbacks bleiben erhalten. |

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

### Paketidentität des tatsächlich getesteten Builds

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

### Nachfolgende Korrekturen benötigen eigene Nachweise

Im Arbeitsbaum nach b754 sind der enge Rust-Fix sowie die UI-Änderungen in
`App.tsx` und `ProviderManager` angewendet. **TypeScript-Prüfung und
Vite-Produktionsbuild bestanden** an diesem geänderten Baum: Die Prüffolge
dauerte insgesamt **223,89 Sekunden**, der Vite-Build **6,72 Sekunden**
bei **1.925 Modulen**. Ein neuer nativer Build liegt noch nicht vor.

Der Rust-Fix erhält bei der erneuten Authority-Prüfung im
Server-Heartbeat ausschließlich den bereits typisiert klassifizierten Fehler
`MESH_ADMISSION_AUTHORITY_UNAVAILABLE` als wiederholbar. Andere
Berechtigungsfehler bleiben terminal und erzeugen kein ACK. Für diese
nachfolgende Korrektur liegt hier **noch kein ausgeführter nativer
Test-/Buildnachweis** vor; sie gehört nicht zur getesteten b754-Binärdatei.

Die zusätzliche UI-Korrektur ordnet den Verbindungseintrag (`agentProviders`)
direkt nach dem Dashboard und die Mesh-/MCP-Karten an den Anfang. Trotz des
bestandenen Web-Builds besitzt diese Änderung **noch keinen nativen Build-
oder vollständigen GUI-Nachweis**. Die sichtbare M3-Prüfung von Workspacewahl,
Dashboard und Verbindungsseite gehört weiterhin zur b754-App.

Ein historischer AB1-Source-Contract wird fachlich an die seit `c93a0ab`
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
Diese einzelne CSS-Regel ist nach dem genannten Web-/Node-Lauf geändert
worden; ihr Build- und visueller Nachweis folgen im nächsten Kandidaten.

Produktive DB-Migration, Cloudflare-Worker-Freischaltung, echte MFA- und
Gerätefreigabe sowie der reale MCP-Gerätezugriff bleiben separate offene
Gates. Das signierte, notarisierte und getestete b754-Paket ist keine vollständige
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
