# KatoSync 4.0 – Cockpit, Navigation und reale Statusdiagramme

Created by NMKato Solutions · 20.11.2026

## Einordnung und Grenze

Diese Änderung ist ein **isolierter UX-Entwicklungsstand**, ausgehend vom privat getesteten Candidate 11. Er ist **noch kein signiertes oder installiertes KatoSync-4.0-Release**. Die reale Verbindung M2/M3 und die M2-Modellantwort des vorigen Kandidaten bleiben historische Nachweise, keine Abnahme dieser neuen Oberfläche.

Die Quellbasis bleibt local-first, mit expliziter Freigabe für Anmeldungen, Geräteidentitäten, Dateien, Remote-Jobs und schreibende Aktionen. Dieses Paket erweitert **keine** native Tauri-/Rust-Berechtigung, keine MFA- oder TLS-Logik, keinen Modell-Prozessmanager und keine Geräte-Freigabe. Die bestehenden Handler bleiben die einzige Aktionsquelle.

## Gestaltungs- und Navigationsentscheidung

- Drei primäre Einstiege: Übersicht, Verbindungen, Vision. Die übrigen Arbeitsbereiche bleiben vollständig über eine bewusst aufklappbare Navigation verfügbar, einschließlich Jobs, Chat, Monitor, Projekte und Verlauf.
- Darstellung, Sprache, Präsentationsmodus, Nutzungsvereinbarung und der Link zu erweiterten Einstellungen sind in einem einheitlichen Einstellungs-Popover untergebracht. Konto, Abmelden und Programm beenden bleiben dauerhaft zugänglich.
- Glass-Effekt nur dort, wo er Hierarchie vermittelt (Navigation, Cockpit, Einstellungen); Datenflächen nutzen leichtere halbtransparente Flächen, um GPU-/RAM-Last niedrig zu halten.
- Gemeinsame Abstands- und Glasvariablen für Dunkel und Hell, sichtbar fokussierbare Kontrollen, mindestens 44 px Bedienflächen, responsive ein- bis dreispaltige Karten, Reduced-Motion-Variante.
- Verbindungscockpit mit sechs Schaltflächen: Geräte-Mesh, Codex, Claude, GitHub, ChatGPT MCP, lokale KI. Die Auswahl zeigt nur Informationen; sie löst weder Pairing noch Login noch neue Berechtigungen aus. Die **explizite** Login- und Testaktion verwendet ausschließlich den bestehenden Provider-Handler.
- OpenAI/Anthropic erscheinen als lokale Bildmarken ausschließlich auf real vorhandenen Provider-Lanes. Die Marken bezeichnen die Anbieter, nicht den Verbindungszustand; Offline- und Limitierungszustände werden unabhängig davon angezeigt.

## Ehrliche Daten und Diagramme

- Provider-Zähler: nur tatsächlich installierte, aktivierte, authentifizierte und verfügbare Codex-/Claude-Anbindungen; **keine** Zusage einer Geräte-Mesh-Verbindung.
- Aktivitätsgrafik: vorhandene, auf sieben Kalendertage begrenzte, deduplizierte Job-Ereignisse und Provider-Zustandswechsel. Bei fehlenden Ereignissen steht „Keine Ereignisse“ – keine simulierten Kurven.
- Git-Chronik: maximal vier lokale Projekte mit vorhandenen HEAD-SHA und Git-Commit-Datum aus den vorhandenen Scans, klar als verifiziert oder beobachtet. Ein Git-Commit-Datum ist **kein Push-Zeitpunkt**. Für Push-Historie und kontinuierliche Netzwerk-/Ressourcen-Kurven muss eine echte, versionierte, begrenzte Telemetriequelle mit Herkunft und Aufbewahrungszeit gebaut werden.
- Präsentationsmodus maskiert die dargestellten Projektnamen und SHA-Ausschnitte der neuen Chronik; private Pfade werden in den neuen Panels nicht angezeigt.

## Abgleich zum verbindlichen 4.0-Fahrplan

| Ziel | Stand dieses UX-Slices | Eigenes funktionales Gate |
|---|---|---|
| UX / Dashboard / Verbindungskacheln | Neue Produktansichten im isolierten Source-Stand | Nativer Gerätetest und UX-Abnahme auf neuem Paket |
| Vision-Provider-Marken | Quelldatengebunden ergänzt | Reale Anbieterzustände im nativen WebKit überprüfen |
| Lokale KI | Anzeige und bestehender RAM-Schutz bleiben unverändert | Modellaktivierung/Persona/M3/Offline-E2E |
| Automatische Offline-Kontextpflege | **Nicht aktiviert**; kein neuer Watchdog | Eigentümer-Opt-in, Allowlist, Read-only-Projekt-Index, Ereignisjournal und Ressourcen-Gate |
| Automatische Modellübernahme | **Nicht aktiviert** | Cloud-Verbindungsstatus, Wake-on-demand, RAM/Akku/Temperatur-Gate, Modellprobe, Restart/Recovery |
| Geräte-Namenswahl | Bestehende technische Alias-Benennung, keine geänderte Identität | Persistente separate Persona, Modellvorschlag und Eigentümerbestätigung |
| Verteilte Jobs / ChatGPT MCP | Bestehende Architektur unverändert | Echte autorisierte Tool-Ausführung und Widerruf; keine stillen Schreibrechte |
| 4.0 Release | **NO-GO** | Agent Birth, OpenClaw/Tool-Sandbox, Mesh-Sicherheitsfälle, Jobs, Windows, Billing, Accessibility |

### Offline-Handoff: sicheres Zielverhalten (noch nicht im UX-Slice umgesetzt)

Ein ressourcensparsamer Watchdog ohne dauerhaftes 4–6-GB-Modell könnte die **explizit registrierten und freigegebenen** Projekt-Metadaten unabhängig vom Netzwerk lesen. Er schreibt bei Änderungen nach überprüfter Herkunft und Commit-/Scan-Bindung einen privaten, zeitlich markierten, begrenzten Statusindex. Beim Verlust der Cloud-Verfügbarkeit darf der Ressourcenprüfer das lokale Modell nur starten, wenn Arbeitsspeicher, Energiezustand und Runtime-Gesundheit dies zulassen. Nach dem Start erhält der Agent ausschließlich diesen freigegebenen Index und prüft widersprüchliche Quellen, bevor er eine Antwort formuliert. Bei Wiederverbindung übernimmt der Cloud-Provider nur nach frischer Authentifizierung die bereits bekannten Fakten; Arbeitsschritte oder Schreibfreigaben werden nicht stillschweigend übertragen.

**Wichtig:** Internetverlust friert Browserprozesse nicht zwingend ein und gibt deren RAM nicht automatisch zurück. Keine fremden Anwendungen schließen, keinen M3-Speicherschutz umgehen, keinen Modell-Download oder Cloud-Login erzwingen. Die neue UI darf diesen Zukunftsablauf nicht als bereits aktiv ausweisen.

## Lokale Prüfbelege, 20. November 2026

- Gesamte Node-Testsuite: **1.028/1.028 erfolgreich**, keine Fehler oder übersprungenen Tests. Darunter die neue Quell-/Zeitfensterprüfung für echte Job-/Provider-Ereignisse und die positiven/negativen Markenprüfungen für Vision.
- Remote-Nutzung: **16/16 erfolgreich**, keine Fehler.
- Synthetische, isolierte Browserabnahme mit den tatsächlichen React-Komponenten: **4/4 Szenarien**, jeweils ohne Frontendfehler, externen Request oder horizontalen Überlauf. Geprüft: Deutsch/Dunkel 1240 px, Englisch/Hell 1040 px, Russisch/Dunkel 720 px und Spanisch/Hell 390 px. Alle eingebundenen Logobilder luden.
- Die sechs Service-Kacheln wurden per Tastatur ausgewählt; nach dem UX-Fix wurde auch ein tatsächlicher Mausklick getestet. **0** Verbindungsaktionen durch die Auswahl; exakt **1** Mock-Aufruf erst nach dem ausdrücklichen Verbinden-Klick. Diese Messung ist keine native Geräte- oder OAuth-Abnahme.
- Abhängigkeitenscan: npm audit gegen den bestehenden Lockfile mit **0 bekannten Schwachstellen**; Lockfile unverändert. Dies ist kein Rust-Advisory-/Penetrationstest.
- Statische Source-/Scope-Prüfung: kein geänderter nativer Auth-, TLS- oder Capability-Code, keine neue direkte Netzwerk-/Prozessaktion in den neuen Cockpit- und Chart-Komponenten; git diff --check erfolgreich.
- Die native macOS-Signatur/Installation, menschlicher Test und vollständige 4.0-Freigabe sind **nicht** durch diese lokalen Checks abgedeckt.

## Manueller Testplan (private Beta)

1. App mit dem **neu signierten** Entwicklungsstand starten; Dunkel/Hell, 1040 × 720 und reguläre Fenstergröße ansehen. Prüfen, dass Navigation, Dialoge und Cockpit nicht abgeschnitten sind.
2. In der Sidebar drei Hauptbereiche prüfen. „Arbeitsbereich“ öffnen: Jobs, Master-Chat, Live-Monitor, Projekte und Verlauf müssen erreichbar sein. „Einstellungen“ öffnen: Sprache, Präsentationsmodus, Theme, Nutzungsvereinbarung und erweiterte Einstellungen prüfen. Escape schließt das Menü ohne weitere Aktion.
3. Im Verbindungscockpit alle sechs Kacheln auswählen. Bei einem bereits angemeldeten Provider nur einen echten Status anzeigen, bei einem nicht angemeldeten Provider erst nach ausdrücklichem Klick den vorhandenen Login öffnen. Kein unbeabsichtigtes Anmelden/Koppeln oder Freigeben.
4. Unter Vision OpenAI-/Anthropic-Marken prüfen. Ein nicht verbundener Provider darf **keinen** grünen Verbindungszustand vortäuschen; seine Markenidentität bleibt erkennbar. In Dashboard die echte Ereignis- und Commit-Herkunft ansehen; „noch keine Daten“ darf keine erfundene Kurve zeigen.
5. M2/M3-Geräteverbindung kontrolliert trennen/verbinden und nach normalem App-Neustart auf beiden Seiten „Verbunden“ sowie tatsächlichen app-eigenen Socket-Verkehr getrennt bestätigen.
6. Lokales Modell nur auf ausreichend freiem RAM starten; M3 bei zu geringer Reserve muss schonend ablehnen. Danach optional einen **ausdrücklich genehmigten, lesenden** Projektauftrag (z. B. CMS) durchführen; Signatur, Projektbindung, Ergebnis und Abbruch separat bestätigen.

**Stopp bei:** Auth-/MFA-Freigabe ohne Nutzeraktion, falschem Online-Zustand, unerklärtem Schreibzugriff, Datenverlust, Absturz, ungesichertem Remote-Task oder instabiler Speicherbelastung.

## Prüfverfahren

- Lokal: `npm run typecheck`, `npm test`, `npm run test:remote-usage`, `npm run build`.
- Reine 4.0-Projektionslogik: `node --experimental-strip-types --test tests/operationalEvidence40.test.ts tests/visionGraph.test.ts`.
- Isolierte Browser-UI: `node scripts/qa-ux-cockpit40.mjs <privater-output-ordner>`; Tests nutzen die tatsächlichen React-Komponenten, aber **nur synthetische Daten**, feste lokale Assets und Loopback.
- Nativer Build, macOS-Signatur, Apple-Notarisierung und E2E-Freigabe folgen erst nach bestandenem Source- und Sicherheitsreview. Ein grüner Browser-Test allein reicht nicht für eine 4.0-Releasefreigabe.

## Folgetest 20.11.2026 — Gateway-Geräte-Deep-Link

**Befund:** Der Gateway-Aufruf wollte `section-account-devices` fokussieren, während die neue konditionale Verbindungsansicht ohne aktive Kachelauswahl das Gerätepanel noch nicht renderte.

**Korrektur ausschließlich im UI:** `openDevicesRequested` von `App` an `ProviderManager` weitergegeben; Gerätebereich wird vor dem Fokus sichtbar, `ConnectionCockpit` verarbeitet den kontrollierten ausgewählten Tile. Browserfixture ergänzt eine synthetische Gateway-Auswahl ohne automatisch ausgelöste Auth-/Connect-Aktion.

**Neu geprüft:** 14/14 fokussierte Node-Tests und `git diff --check` PASS; 4/4 isolierte Browserfälle bei 1240/1040/720/390px in DE/EN/RU/ES PASS, ohne externe Requests, Fehler, Überlauf oder implizite Provider-Freigaben. Bericht/Screenshots: privater lokaler QA-Ausgabeordner (nicht versioniert). Hell/390 und Dunkel/1240 Screenshots visuell eingesehen.

**Abnahmegrenze:** Zusätzlich gestarteter TypeScript-Gesamtlauf wegen sehr hoher M2-Auslastung abgebrochen, nicht als PASS werten; kein vollständiger Node-/Rust-/macOS-/Windows-Test nach Fix, kein nativer C12-Installer, Push oder Merge. Ursprüngliche Belege oben sind frühere Source-Freeze-Nachweise. Vor Freigabe: vollständiger Source-/TS-Review, konfliktbewusste Branch-Reconciliation und native WebKit-/Geräteabnahme.
