# KatoSync C12 – Unified UX und MCP-Gates

Created by NMKato Solutions · 20.11.2026

## Scope und Auswahl

- Ausgangspunkt: GitHub-Branch `feat/ux-cockpit-navigation-20261120` @ `30454a3`, dessen C11-Merge-Base `3ddd71e` ist. Neuer isolierter Branch: `feat/c12-unified-best-of-20261120`. Die vorhandenen signierten Candidate-11-Apps auf M2/M3 bleiben unverändert.
- Best-of: sechs kontrollierte Verbindungskacheln (SmartMesh, Codex, Claude, GitHub, ChatGPT MCP, Local Brain), klare Navigation, 2 × 3-Karten bei 390 px, zusammengefasste Einstellungen und echte begrenzte Dashboard-Ereignisse statt synthetischer Produktionskurven.
- Die bisherige 5-Kachel-C12-Alternative bleibt als historischer Quellen- und Teststand erhalten. Die M2-lokalen, zuvor uncommitteten Quelländerungen wurden in einen neuen Worktree kopiert, nicht im ursprünglichen Worktree überschrieben.
- Bei Kachelwechsel bleiben bereits eingebundene Geräte-/MCP-/GitHub-/Providerformulare gemountet und nur visuell verborgen; damit gehen lokale Review-Zustände nicht durch reines Navigieren verloren. Kein automatischer Auth-/Freigabeschritt.
- Gateway-Deep-Link Meine Geräte öffnet die Gerätekarte vor dem Fokus. Anbieterlogos identifizieren tatsächliche Vision-Lanes, nicht deren Onlinezustand. Offline/Quota/Frische werden unabhängig angezeigt.

## Daten- und Sicherheitsvertrag

- Operative Graphen verwenden nur vorhandene datierte Job- und Providerwechsel-Ereignisse. Das Zeitfenster ist sieben Kalendertage, doppelte Ereignisse werden dedupliziert; fehlende Daten erzeugen einen echten Empty State.
- Git-Projektchronik nutzt begrenzte registrierte lokale HEAD-Snapshots samt Commit-Datum. Das Commit-Datum wird nicht als GitHub-Push-Zeit bezeichnet; nur HEAD-gebundene Verifikation darf als geprüft erscheinen.
- Keine neue Rust-/Tauri-Capability, keine OAuth-/MFA-/Peer-/TLS-/Serveränderung, keine automatischen Schreib-, Netzwerk-, Terminal- oder Modellaktionen durch Cockpit-Navigation.
- Die vorliegenden Tests sind synthetische React-/Browserprüfungen; sie ersetzen keine echte signierte WebKit-/M2-/M3-/Windows-Abnahme.

## Neuer Quelltest

- **Vollständige Node-Regression auf dem konsolidierten Quellstand: 1030/1030 PASS, 0 Fehler, 0 Skips, Exit 0.** Bei der ersten Integration wurden drei ältere Vertragsbrüche sichtbar (GitHub-Placement/Responsive-CSS und getrennt abgesicherte Mesh-/MCP-Ownerkarten); alle wurden behoben. Die zusätzliche gezielte Folgeregression über die betroffenen fünf Testdateien bestand mit **28/28 PASS**. Die erste kleinere Suite hatte zuvor **19/19 PASS**.
- `npm run typecheck` bestand mit Exit 0. **Auch der abschließende `npm run build` auf dem exakt finalen Quellstand bestand (Exit 0)**: TypeScript erfolgreich, Vite 8.3.5 mit 1.931 transformierten Modulen und erfolgreich erzeugter Main-/Widget-Bündelung. Vite meldete die bestehende **nicht-blockierende Hauptbundle-Größenwarnung** (Main-JS circa 1,42 MB), keinen Buildfehler.
- `node scripts/qa-ux-cockpit40.mjs <privater-ausgabeordner>`: **4/4 PASS** (DE/dunkel 1240, EN/hell 1040, RU/dunkel 720, ES/hell 390). Kleinste Ansicht bestätigt zwei Kachelspalten. Browserfehler, externe Requests, horizontaler Overflow und unbeabsichtigte Provideraktionen: jeweils null. 390-px-Bild visuell überprüft.
- **Remote-Nutzungsvertrag: 16/16 PASS, Exit 0.** `npm audit --audit-level=high` meldet am 20.11.2026 **0 bekannte Schwachstellen** (0 Info/Low/Moderate/High/Critical); das Lockfile wurde nicht geändert. Ein echter nativer C12-Gerätetest, Windows-/macOS-Installer und signierte Apple-WebKit-Abnahme stehen unabhängig von diesen grünen Source-/Browserbefunden aus; kein 4.0-GO.

## Realer KatoSync MCP: geprüfter Ist-Zustand

- ChatGPT-Connector hat ausschließlich `katosync_qa_ping` angeboten. Der Test ergab `authenticated_synthetic_qa`, `meshConnected=false`, `deviceAccessEnabled=false`. Diese Werte beschreiben den synthetischen Connector, nicht den separat geprüften nativen C11-Mesh.
- Das separate Gateway-Repositorium `NMKato/KatoSync-Remote-MCP` enthält auf `beta/4.0-runtime-integration-20261118` quellseitige, gegatete Werkzeuge `devices.list`, `device.status` und `katosync_git_status`. Das aktuelle live angeschlossene Toolset enthält diese **nicht**.
- Der Desktop besitzt native Owner-/Device-Review- und Relay-Funktionen sowie nur das begrenzte Terminalprofil `git_version`. Dies ist noch keine allgemeine Terminal-, Dateisystem- oder GUI-Fernsteuerung.
- Erster echter Pilot: Client-OAuth-Grant mit Owner-MFA, konkrete Device-Freigabe, registriertes Projekt, authentifizierter signierter WSS/Relay-Socket, aktiviertes freigegebenes Git-Tool, aktueller Tool-Discovery-Refresh in ChatGPT. Dann einen read-only Git-Status einmalig aus diesem Chat auslösen, signiertes Geräteergebnis prüfen und mit unabhängigem lesendem RDC-Git-Status vergleichen.
- Shell/Dateien/Prozesse/Computer Use folgen als eigene sicherheitsgeprüfte Funktionsstufen gemäß `NMKato/KatoSync#241`; niemals aus Ping oder bloßem Login vollständige OS-Rechte ableiten.

## Freigaben

- Kein automatischer `main`-Merge, keine Live-Datenbank-/Worker-/OAuth-Änderung, kein neuen teurer GitHub-Actions-Lauf durch diese UI-Zusammenführung.
- C11 bleibt Installations-Rollback. Vor C12-Paketfreigabe: finale Node/TS/Vite- und unabhängige Securityprüfung, native WebKit-Sicht, signiertes/notarisiertes isoliertes Paket und kontrollierter tatsächlicher M2/M3-Test.
- **Status: C12 als privater Quell- und UX-Kandidat; 4.0 und echter Remote-Desktop-Commander-Ersatz bleiben NO-GO bis zu ihren E2E-Gates.**
