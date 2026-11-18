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

| Bereich | Implementierung | Erforderlicher Abnahmebeleg |
|---|---|---|
| Geräte-UI | Frische Kontoliste, Auswahl, historische Registrierungen, Rollenwahl, native Zustandsanzeige | Native GUI auf beiden Macs |
| Mesh-Dienst | Tatsächlicher mTLS-Socket, Heartbeat-Lease, Reconnect, Stop, Owner-Wechsel | Derselbe neue signierte Build auf M2 Pro und M3 |
| Sitzung | Serialisierte Tokenrotation, MFA, Logout-Sperre und Generation-Fencing | Native Tests und Logout während laufender Operation |
| MCP-Freigabe | Owner-/Ziel-Client-Trennung, frische MFA, einmalige geprüfte Entscheidung | Echte Owner-Bestätigung; keine vorbereiteten Approved-Datensätze |
| MCP-Präsenz | Gepinnte signierte Challenge/ACK, kurzlebige WSS-Sitzung, Widerrufsprüfung | Produktiver Worker, echte DB-Rollen und echtes freigegebenes Gerät |
| Verpackung | Eigener signierter/notarisierter Kandidat mit geprüftem Ressourcenbestand | Signatur, Staple, Start und Rollback auf beiden Geräten |

## Verifikation: Stand der Integration

Die konkreten Ausführungsbelege werden hier nach den tatsächlichen Läufen
ergänzt. Vorherige Stage4U/Stage4AA-Pairing- und TLS-Nachweise bleiben
historische Belege; sie ersetzen nicht den Test dieses neuen Builds.

- Vollständiger Node-Lauf: **975/975 bestanden**, keine übersprungenen Tests
  (18.11.2026). TypeScript und Vite-Produktionsbuild ebenfalls bestanden.
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
- Signierter/notarisierter Paketbau, Start und native GUI-Prüfung auf beiden
  tatsächlichen Macs sowie echte Benutzer-MFA und individuelle Gerätefreigabe
  bleiben getrennt abzunehmen. Der erfolgreiche Bibliothekslauf ist kein
  Installations- oder physischer Mesh-Nachweis.
- Produktive DB-Migration, Worker-Freischaltung und echte MFA-/Gerätefreigabe
  sind noch nicht als abgeschlossen protokolliert.
- Der Abhängigkeitsaudit bleibt ein eigener erforderlicher CI-Gate. Der
  bekannte Picomatch-Befund wird nicht durch Deaktivieren des Audits übergangen.

## CI-Ausführung und Kosten

KatoSync ist zum Prüfzeitpunkt ein öffentliches Repository. Die verwendeten
Standardrunner `ubuntu-latest`, `windows-latest` und `macos-15` sind deshalb
[compute-kostenfrei und verbrauchen kein inkludiertes Compute-Kontingent](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Runner-Laufzeit ist hier nicht mit einer tatsächlichen Kontingentabbuchung
gleichzusetzen; Speicher wird getrennt betrachtet.

Derselbe Commit `c93a0ab` wurde durch `push` und `pull_request` doppelt im
Beta4-Mac-Workflow geprüft: [Push-Lauf](https://github.com/NMKato/KatoSync/actions/runs/44294689069)
mit 4:55 Minuten und [PR-Lauf](https://github.com/NMKato/KatoSync/actions/runs/44294697659)
mit 5:08 Minuten Joblaufzeit. Der zusätzliche Branch-Push-Trigger wird entfernt.
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
