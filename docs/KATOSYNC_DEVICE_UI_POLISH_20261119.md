# Geräte-UX: Gestaltung und Komponentenprüfung

Created by NMKato Solutions

Stand: 19. November 2026, 22:36 MEZ. Ausgangsstand: `2d66076b243915d5ddd082e578104477d5d5aea0`.

## Änderung

Der Gateway bietet den direkten Zugang „Meine Geräte“. Die aktive Geräteverwaltung steht vor der Anbieterreihenfolge und erhält nach dem Einstieg den Fokus. Navigation registriert oder bestätigt kein Gerät. Kontogebundener Kontext, Freigaben, Hauptgeräte-Revision und bestehende Aktionshandler bleiben erhalten.

Ein gemeinsamer Satz von Farbwerten und Abständen gibt Einstieg, Geräteverwaltung, Freigabedialogen und lokalem Modellbereich ruhige Flächen. Schaltflächen erhalten großzügige Trefferflächen, lange Bezeichnungen dürfen umbrechen und Hell/Dunkel haben eigene Statusfarben. Die RAM-Angabe bezeichnet den verbauten Arbeitsspeicher. Der Speicherhinweis erläutert, warum freier Festplattenspeicher keinen verfügbaren RAM ersetzt.

## Tatsächlicher Komponentenlauf

Der zweite vollständige Lauf bestand mit **56 Prüfungen und 26 Aufnahmen**. Keine Frontend-Ausnahme und kein externer Browserrequest wurde registriert. Die tatsächlichen React-Komponenten liefen mit ausdrücklich synthetischen Konten, Geräten, Modellzuständen und Handlern; der Lauf verwendet keine Tauri-Brücke und erteilt keine echten Freigaben.

Geprüft wurden beide Themen, Gateway bei 1240 × 820 und 1040 × 720, lange Gerätenamen, isolierte Karten bei 390 px, Deutsch/Englisch/Spanisch/Russisch, Modellzustände, sichtbarer Tastaturfokus, explizite Registrierung/Freigabe, revisionsgebundene Hauptgerätewahl und zweistufiger Widerruf. Die schmale Kartenprüfung ist keine mobile Abnahme der vollständigen Desktop-App.

Der erste Lauf fand einen verlorenen Fokus nach Escape. Ursache war die vorzeitige React-Fokussierung vor `showModal()`. Der korrigierte Dialog merkt den vorherigen Auslöser und stellt Fokus nur zu einem weiterhin vorhandenen, aktivierbaren Element wieder her. Der zweite Lauf prüfte Escape ohne Freigabe, Fokusrückkehr und anschließende erneute Bedienung erfolgreich.

## Gemessene ausgewählte Textkontraste

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

Dies ist eine gezielte Messung dieser Komponenten und keine Konformitätsbescheinigung für die gesamte App. Die erzeugten Bilder wurden zusätzlich visuell geprüft; die Sichtprüfung ergab keinen Layoutblocker.

## Sicherheitskorrektur

Ein nativer Guard beschränkt eigene App-Kommandos anhand der tatsächlichen Window- und Webview-Labels. Das Hauptfenster behält den bestehenden Dispatcher. Das QA-Widget erhält ausschließlich seine sechs verwendeten Anzeige-, Navigations- und Fensterbefehle; unbekannte oder widersprüchliche Herkunft wird vor Dispatch abgelehnt. Der Schutz ergänzt die bestehenden Plugin-Capabilities und fachlichen Konto-/Freigabeprüfungen.

Sechs gezielte Rust-Tests prüfen die erlaubten und verweigerten Pfade einschließlich der Nichtausführung eines abgelehnten Handlers. Die tatsächliche native Kompilierung und die Prüfung des signierten Kandidaten sind gesonderte Gates; der Komponentenlauf ersetzt sie nicht.

## Abschließende lokale Prüfungen

Der vollständige Node-Testlauf vom 19. November 2026 bestand mit **1.020 Tests, null Fehlern und null übersprungenen Tests**. Die zusätzlichen Remote-Nutzungstests bestanden mit **16 von 16**. TypeScript-Prüfung und Vite-Produktionsbuild liefen erfolgreich durch. Vite meldete weiterhin eine Größenwarnung für den Haupt-JavaScript-Chunk; dies ist kein Buildfehler und bleibt ein gesondertes Optimierungsthema.

Der erste Gesamtlauf hatte 14 Fehler in bereits überholten Testverträgen gemeldet. Sämtliche Fehler wurden im unveränderten Ausgangsstand reproduziert. Die Wartung aktualisiert den direkten Geräte-Einstieg, die exakte vorhandene Migrationsliste und Hash-Pins der unveränderten Inbox-Handler. Die Mitgliedschaftsprüfung verlangt weiterhin beide erlaubten Zustände sowie Konto- und Widerrufsprüfung. Es wurden keine Tests übersprungen und keine produktiven Berechtigungen oder Cloud-Migrationen verändert. Der danach erneut ausgeführte Gesamtlauf ist der oben genannte bestandene Lauf.

`npm audit --package-lock-only` meldete null bekannte Schwachstellen. Die unabhängige Quellprüfung und gezielten Prüfungen sind keine vollständige Sicherheitszertifizierung; ein Rust-Advisory-Scan wurde nicht ausgeführt. Der native Build, seine Rust-Tests und die tatsächliche Abnahme der signierten App stehen zum Zeitpunkt dieses Dokuments noch aus.

## Wiederholen

```sh
node scripts/qa-account-mesh-ui.mjs /tmp/katosync-ui-review
npm test
npm run test:remote-usage
npm run build
```

Ein bereits installierter, zur Playwright-Version passender Browser kann über `KATOSYNC_QA_CHROME` gewählt werden. Der Runner bindet eine feste Asset-Liste ausschließlich an Loopback, blockiert externe Requests und schreibt `result.json`, PNGs und eine Galerie in den angegebenen Ausgabeordner. Er installiert keinen Browser. Die nativen Tests und der ARM64-Paketbau folgen anschließend im bestehenden Beta-Workflow aus demselben freigegebenen Source-Commit.
