# Geräte-UX: Gestaltung und Prüfstand C9–C11

Created by NMKato Solutions

Stand: 20. November 2026. C10 ist nativ gebaut und privat installiert. Seine anschließende Verbindungsabnahme hat einen blockierten Peerzustand und eine bislang unzureichende Fehleranzeige aufgedeckt. C11 ergänzt gezielt diese Anzeige; eine behobene Transportursache wird damit noch nicht behauptet.

## C11: nachvollziehbare Hinweise bei blockierter Verbindung

Die Gerätekarte unterscheidet jetzt zwischen **„Verbindung prüfen“** für eine blockierte Verbindung und **„Freigabe nötig“** für eine fehlende Gerätefreigabe. Der nächste Schritt steht direkt am betroffenen Gerät, auch wenn am Hauptgerät noch kein Teilnehmer ausgewählt ist. Hinweise zu Konto, Netzwerk, Geräteprüfung und geänderter Geräteauswahl werden aus dem tatsächlich gebundenen Zustand abgeleitet.

Technische Einzelheiten erscheinen erst nach einem eigenen, per Tastatur bedienbaren Detailsbutton. Der Button besitzt mindestens 44 px Höhe, einen sichtbaren Fokus und einen eindeutigen gerätespezifischen Namen. Fehlertexte und Details verwenden die vorhandenen Hell-/Dunkelfarben und Abstände; lange Codes dürfen umbrechen.

Die Ausgabe verwendet ausschließlich **98 feste öffentliche Fehlercodes** aus dem nativen Quellvertrag. Unbekannte, fehlende oder zusammengesetzte Werte bleiben verborgen und erhalten einen allgemeinen Hinweis. Ein Fehlercode allein beweist keinen tatsächlich widerrufenen Pin: Einige native Fehlerkategorien fassen mehrere Prüfursachen zusammen.

Ein Peerhinweis verlangt weiterhin die vorhandene Bindung an Konto, lokales Gerät, Hauptgerät, Revision, Fingerprint und Rolle. Ein globaler Fehler wird einem einzelnen Gerät nicht ersatzweise zugeordnet. Ein eigener Hauptgerätehinweis erscheint nur für den exakt gebundenen, verfügbaren lokalen Hauptserver im blockierten Zustand. Parser, Context, native Befehle, Authentifizierung, TLS und Freigabe-Callbacks sind unverändert; das Öffnen der Details ändert ausschließlich lokalen Darstellungszustand.

## C11: Review und lokale Verifikation

Der unabhängige Sicherheitsreview der sieben Produkt-/Prüfdateien fand keinen konkreten Blocker. Alle 98 ausgegebenen Enumwerte wurden gegen vorhandene native Stringliterale geprüft. Der Browserharness bleibt auf feste Loopback-Assets begrenzt und verweigert externe Requests.

Der erste C11-Prüfstand bestand **18 von 18 Onboarding-Tests** sowie **1.024 von 1.024 Tests der vollständigen Node-Suite**, ohne Fehler oder übersprungene Tests. TypeScript und Vite-Produktionsbuild waren erfolgreich. Alle **967 erfassten Dateiinputs** blieben während dieses Gesamtlaufs unverändert; Abschluss: 20. November 2026, 00:08:37 UTC.

Der gezielte Komponentenlauf bestand mit **acht Szenarien und sechs Aufnahmen**. Geprüft wurden vier Sprachen, Hell-/Dunkelansichten, Tastaturbedienung, schmale Karten, unbekannte Codes, veraltete Bindungen, Hinweise ohne Teilnehmerauswahl und die Trennung zwischen Peer- und Hauptgerätefehler. Die Mock-Aufzeichnung bestätigt, dass die Detailanzeige keine Geräte-, Freigabe- oder Modellaktion auslöst.

Die Bildprüfung fand anschließend noch eine zu spezifische Netzwerkformulierung für den lokalen Hauptserver. Die vier Sprachfassungen wurden deshalb auf einen neutralen ersten Satz eingegrenzt. Der Gesamtlauf oben bezieht sich auf den Stand vor dieser reinen Textkorrektur. Der abschließende gezielte Nachtest bestand mit **vier Szenarien und vier tatsächlich angesehenen Bildern** (Deutsch/Englisch breit, Spanisch/Russisch schmal), ohne Frontendfehler oder externe Requests. Die sieben UI-/Prüfdateien blieben während des Nachtests unverändert; eine inverse Textprüfung bestätigt ausschließlich diese vier Satzänderungen seit dem Gesamtlauf.

**Native C11-CI, signiertes Paket und physische Verbindungsabnahme stehen noch aus.** Die neue Diagnoseanzeige ersetzt keinen Nachweis einer stabilen, authentifizierten Verbindung.

## C10: nach dem damaligen Quellfreeze verifiziert

[CI-Lauf 44634391972](https://github.com/NMKato/KatoSync/actions/runs/44634391972) für Quelle 9fbd76586def90a83fd1dc2a83abf1b1fd635f27 bestand mit **14 Onboarding-Tests und 540 Rust-Tests**. Acht bereits vorhandene native Tests blieben als ignoriert ausgewiesen. Alle 13 Guard-/Listener-Recovery-Regressionen bestanden.

Das signierte, von Apple akzeptierte Paket wurde privat installiert. Die tatsächliche native Ansicht bestätigte den korrigierten kompakten Sidebar-Bereich. Die spätere Verbindungsabnahme zeigte jedoch erneut blockierte Verbindungen. Automatisch aufgebaute TCP-Sockets allein wurden ausdrücklich nicht als vollständiger authentifizierter Mesh-Nachweis gewertet. C11 macht die bereits vorhandenen nativen Gründe dafür beobachtbar, ohne die zugrunde liegenden Prüfungen zu lockern.

## Historischer Prüfstand C9/C10 beim Quellfreeze

Die folgenden Abschnitte dokumentieren den Stand vom 19. November 2026, 23:00 UTC. Damals als ausstehend bezeichnete C10-Gates sind anhand des aktuellen Abschnitts oben einzuordnen.

### Änderung

Der Gateway bietet den direkten Zugang „Meine Geräte“. Die aktive Geräteverwaltung steht vor der Anbieterreihenfolge und erhält nach dem Einstieg den Fokus. Navigation registriert oder bestätigt kein Gerät. Kontogebundener Kontext, Freigaben, Hauptgeräte-Revision und bestehende Aktionshandler bleiben erhalten.

Ein gemeinsamer Satz von Farbwerten und Abständen gibt Einstieg, Geräteverwaltung, Freigabedialogen und lokalem Modellbereich ruhige Flächen. Schaltflächen erhalten großzügige Trefferflächen, lange Bezeichnungen dürfen umbrechen und Hell/Dunkel haben eigene Statusfarben. Die RAM-Angabe bezeichnet den verbauten Arbeitsspeicher. Der Speicherhinweis erläutert, warum freier Festplattenspeicher keinen verfügbaren RAM ersetzt.

### Komponentenlauf im C9-Vorlauf

Der zweite vollständige Komponentenlauf bestand mit **56 Prüfungen und 26 Aufnahmen**. Keine Frontend-Ausnahme und kein externer Browserrequest wurde registriert. Die tatsächlichen React-Komponenten liefen mit ausdrücklich synthetischen Konten, Geräten, Modellzuständen und Handlern; der Lauf verwendet keine Tauri-Brücke und erteilt keine echten Freigaben.

Geprüft wurden beide Themen, Gateway bei 1240 × 820 und 1040 × 720, lange Gerätenamen, isolierte Karten bei 390 px, Deutsch/Englisch/Spanisch/Russisch, Modellzustände, sichtbarer Tastaturfokus, explizite Registrierung/Freigabe, revisionsgebundene Hauptgerätewahl und zweistufiger Widerruf. Die schmale Kartenprüfung ist keine mobile Abnahme der vollständigen Desktop-App.

Der erste Lauf fand einen verlorenen Fokus nach Escape. Ursache war die vorzeitige React-Fokussierung vor `showModal()`. Der korrigierte Dialog merkt den vorherigen Auslöser und stellt Fokus nur zu einem weiterhin vorhandenen, aktivierbaren Element wieder her. Der zweite Lauf prüfte Escape ohne Freigabe, Fokusrückkehr und anschließende erneute Bedienung erfolgreich.

### Gemessene ausgewählte Textkontraste

Die Prüfung berechnet sRGB-Kontrast aus den tatsächlichen Farben und deckenden Hintergrundschichten, einschließlich Alpha-Komposition. Sie verlangt mindestens 4,5:1 für die ausgewählten normalen Texte. Unbestimmte Bilder oder Filter zählen nicht als belastbarer Nachweis.

| Zustand | Textproben | Niedrigster gemessener Kontrast |
|---|---:|---:|
| ready-dark | 3 | 8.436:1 |
| approval-dark | 5 | 5.47:1 |
| ready-light | 3 | 5.382:1 |
| approval-light | 5 | 5.656:1 |
| connected-dark | 3 | 8.082:1 |
| local-brain-running-dark | 2 | 7.743:1 |
| connected-light | 3 | 5.628:1 |
| local-brain-running-light | 2 | 6.543:1 |

Dies ist eine gezielte Messung dieser Komponenten und keine Konformitätsbescheinigung für die gesamte App. Die erzeugten Bilder wurden zusätzlich visuell geprüft; in diesen synthetischen Komponenten wurde kein Layoutblocker gefunden. Der spätere native Sidebar-Befund betrifft einen zuvor nicht enthaltenen Teil der vollständigen App.

### Sicherheitskorrektur und C9-CI

Ein nativer Guard beschränkt eigene App-Kommandos anhand der tatsächlichen Window- und Webview-Labels. Das Hauptfenster behält den bestehenden Dispatcher. Das QA-Widget erhält ausschließlich seine sechs verwendeten Anzeige-, Navigations- und Fensterbefehle; unbekannte oder widersprüchliche Herkunft wird vor Dispatch abgelehnt. Der Schutz ergänzt die bestehenden Plugin-Capabilities und fachlichen Konto-/Freigabeprüfungen.

Sechs gezielte Rust-Tests prüfen die erlaubten und verweigerten Pfade einschließlich der Nichtausführung eines abgelehnten Handlers. **C9-CI-Lauf 44620830876 bestand mit 14 Onboarding-Prüfungen und 533 bestandenen Rust-Tests.** Acht bereits vorhandene Rust-Tests blieben als `ignored` ausgewiesen; dies sind keine zusätzlichen C10-Auslassungen.

TypeScript-Prüfung und Vite-Produktionsbuild waren für C9 erfolgreich. Vite meldete weiterhin eine Größenwarnung für den Haupt-JavaScript-Chunk; dies ist kein Buildfehler und bleibt ein gesondertes Optimierungsthema.

### Nativer C9-Befund und begrenzte C10-Rail-Korrektur

Die tatsächliche native C9-Fensterprüfung bei einem äußeren Fenstermaß von **1040 × 720** zeigte einen Sidebar-Fehler: Die zweispaltige Moduswahl ragte aus der 80-px-Leiste, und spätere CSS-Regeln beeinträchtigten die kompakte Fußzeile. Das Außenmaß ist kein Nachweis eines gleich großen CSS- oder Webview-Inhaltsbereichs.

C10 begrenzt die Korrektur auf die kompakte Sidebar bis 1120 px: Moduswahl untereinander, sichtbarer Tastaturfokus, vollständige zugängliche Buttonnamen, ausreichend große Footer-Trefferflächen und ein innerhalb der Leiste bleibender Kontobadge. Die breite Sidebar und die bestehenden Aktionshandler bleiben erhalten. Der unabhängige Review der vier betroffenen UI-/Prüfdateien fand keinen verbleibenden Produktblocker.

Der gezielte Rail-Test reproduzierte zunächst den Fehler. Nach der Korrektur bestanden **drei Szenarien mit fünf Aufnahmen**: Hell/Dunkel bei 1040 × 720 sowie die breite Kontrollansicht bei 1240 × 820. Modusbuttons messen 44 × 44 px, Footerbuttons 46 × 44 px; bei 1240 px bleiben die 232-px-Sidebar und Beschriftungen sichtbar. Enter/Leertaste, Fokus und `aria-pressed` wurden geprüft; die aufgezeichneten Mockaktionen betreffen ausschließlich die Moduswahl.

Die zusätzliche Sichtprüfung fand noch einen Wortumbruch im Badge. Nach der letzten rein typografischen Änderung auf `letter-spacing: -0.15px` bestand der gezielte Nachtest erneut: **drei Szenarien, fünf Bilder, null Frontendfehler und null externe Requests**. Alle vier erfassten UI-Dateien blieben während dieses Nachtests unverändert. Die fokussierten Hell-/Dunkelbilder wurden tatsächlich angesehen; „KATOOS“ steht vollständig über „Family“. Der finale UI-Freeze wurde um **23:00:11 UTC** bestätigt.

Diese Nachweise sind synthetische Browserprüfungen mit echten Komponenten und Mockhandlern. Die native C10-WebKit-Abnahme bleibt ein eigener Schritt.

### C10: Wiederaufnahme fehlender Listener

Ein vorübergehend fehlgeschlagener Discovery- oder Bindversuch konnte einen zweiten Verbindungspfad dauerhaft fehlen lassen, obwohl bereits ein anderer Listener aktiv war. Die C10-Korrektur ergänzt fehlende LAN-/Overlay-Listener über einen periodischen Tick, ohne vorhandene Listener oder Peer-Tasks neu zu starten. Es bleiben höchstens zwei Listener mit unterschiedlichen konkreten Adressen zulässig.

Nach dem asynchronen Nachbinden werden Kontobindung und aktuelle Eigentümergeneration erneut geprüft. Eine fehlgeschlagene zusätzliche LAN-Ankündigung beendet den vorhandenen Overlaypfad nicht. Die bestehenden Prüfungen von Route, Socketadressen, lokal genehmigtem Peer-Pin, Public Key, Native Admission und TLS 1.3 bleiben erhalten.

**Sieben gezielte std-only Regressionstests gegen das tatsächliche Produktionsmodul bestanden mit 7/7.** Sie prüfen fehlende Pfade, Wiederaufnahme nach vorübergehendem Fehler, Erhalt vorhandener Bindungen, die Zwei-Listener-Grenze sowie die Ablehnung doppelter Adressen, Wildcardadressen und falscher Listener-Arten. Der unabhängige Review der beiden Runtime-Dateien fand keinen verbleibenden konkreten Blocker.

Der gezielte Lauf verwendete weder Cargo/CI noch echte Ports oder App-Aktionen. Er belegt die Recovery-Policy; die vollständige Runtime-/Tokio-Integration und der native Wiederverbindungstest folgen mit C10.

### Lokale Gesamtprüfung und verbleibende Gates

Der vollständige C10-Node-Lauf endete am **19. November 2026 um 22:55 UTC** erfolgreich: **1.020 von 1.020 Tests**, null Fehler und null übersprungene Tests. Die zusätzlichen Remote-Nutzungstests bestanden mit **16 von 16**, ebenfalls ohne Fehler oder übersprungene Tests. Alle **634 erfassten Eingabedateien** blieben während dieses Laufs unverändert.

Diese Gesamtprüfung erfolgte **vor der letzten rein typografischen Badge-Wertänderung**. Der danach ausgeführte, oben dokumentierte gezielte Rail-Nachtest prüft den endgültigen UI-Stand. Es wird kein erneuter vollständiger Node-Lauf nach dieser letzten Wertänderung behauptet.

Bereits im C9-Vorlauf hatte der erste Gesamtlauf 14 Fehler in überholten Testverträgen gemeldet. Sämtliche Fehler wurden im unveränderten Ausgangsstand reproduziert. Die Wartung aktualisierte den direkten Geräte-Einstieg, die exakte vorhandene Migrationsliste und Pins der unveränderten Inbox-Handler. Die Mitgliedschaftsprüfung verlangt weiterhin beide erlaubten Zustände sowie Konto- und Widerrufsprüfung. Es wurden keine Tests übersprungen und keine produktiven Berechtigungen oder Cloud-Migrationen verändert.

Im C9-Vorlauf meldete `npm audit --package-lock-only` null bekannte Schwachstellen. Die unabhängigen Quellprüfungen und gezielten Prüfungen sind keine vollständige Sicherheitszertifizierung; ein Rust-Advisory-Scan wurde nicht ausgeführt.

**Noch ausstehend sind die native C10-CI, die Prüfung des daraus erzeugten signierten Pakets und die tatsächliche C10-App-Abnahme einschließlich Wiederverbindung nach normalem Neustart.** Die lokalen Befunde oder der bestandene C9-CI-Lauf ersetzen diese C10-Gates nicht.

### Wiederholen

```sh
node scripts/qa-account-mesh-ui.mjs /tmp/katosync-ui-review
node scripts/qa-account-mesh-ui.mjs /tmp/katosync-rail-review --rail-only
npm test
npm run test:remote-usage
npm run build
```

Ein bereits installierter, zur Playwright-Version passender Browser kann über `KATOSYNC_QA_CHROME` gewählt werden. Der Runner bindet eine feste Asset-Liste ausschließlich an Loopback, blockiert externe Requests und schreibt `result.json`, PNGs und eine Galerie in den angegebenen Ausgabeordner. Er installiert keinen Browser. Die nativen Tests und der ARM64-Paketbau folgen anschließend im bestehenden Beta-Workflow aus demselben freigegebenen Source-Commit.
