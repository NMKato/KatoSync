# KatoSync UX4 – Native UX-Abnahme und kompakte Seitenleiste

Created by NMKato Solutions · 21.11.2026 · privater QA-Kandidat

## Native Bedienprüfung (bestehender korrigierter KatoOS-QA-Build)

- App: **KatoSync 4.0 KATOOS QA** auf M3/macOS; KatoOS-Anmeldung wurde durch sichtbare authentifizierte Agent-Sync-Oberfläche bestätigt. Der vorherige Candidate-11-Prozess war vom Owner regulär beendet; kein ungewollter automatischer Neustart.
- **9/9 Agent-Sync-Bereiche nativ per macOS Accessibility geöffnet:** Übersicht, Verbindungen, Vision, Projekte, Jobs & Queue, Live-Monitor, Verlauf & Nachweise, Master-Chat und Einstellungen. Views öffneten, ohne dass Remote-Jobs, Freigaben, Git-Schreibaktionen oder Automatikmodi gestartet wurden.
- **Theme 3/3 per echter UI-Bedienung:** Hell, Dunkel, Auto. Auf dem geprüften macOS-System folgte Auto dem dunklen Systemfarbschema. Am Ende wurde **Hell** als Nutzerstandard wiederhergestellt.
- Native Fenstergröße von 1380 × 860 auf **1040 × 720** verkleinert und anschließend vollständig wiederhergestellt. App blieb stabil; das einspaltige/kompakte Layout reagierte.
- Erkennbare Zustandsgrenzen: Nicht bestätigte Mesh-/RDC-/MCP-Rechte blieben neutral; ein bereits vorhandener KI-Provider erschien als verfügbar; keine lokalen Projekte im isolierten QA-Profil registriert. Deshalb **kein** realer Projekt-/Git-/Agenten- oder MCP-End-to-End-Auftrag ausgelöst.
- QA-Stand der laufenden App zum Zeitpunkt dieser Bilder ist **d6c5c8e**, nicht der nachfolgende UX-Patch. Bilder aus der nativen Abnahme enthalten potenziell Kontoinformationen und bleiben privat auf dem M3, nicht in Git.

## Bestätigte UX-Funde

1. **P1 – Unlesbarer Theme-Footer bei 1040 px:** Das Basissystem reduziert die Sidebar auf Symbole, aber die drei Textlabels Hell/Dunkel/Auto überlagerten sich im 80-px-Fußbereich.
2. **P2 – Doppelte Bezeichnung „Einstellungen“:** Agenten-Konfiguration und Darstellung/Sprache wurden unter derselben Bezeichnung angeboten.
3. **P2 – Persistente Login-Erfolgsmeldung:** Ein erfolgreicher Anmeldebanner blieb auf sämtlichen Agent-Sync-Seiten länger als nötig sichtbar und belegte vertikalen Platz.
4. **Beobachtung, nicht als Defekt bewertet:** In Screen-Captures blieben Hover-Tipps sichtbar, solange der Mauszeiger über Navigationseinträgen stand. Nach einer echten Mausbewegung verschwanden sie.

## Implementierte rein visuelle Korrekturen im Folgebranch

- Bei **max-width 1120 px** wird ausschließlich die dreifach beschriftete Theme-Auswahl im Sidebar-Footer ausgeblendet. Die drei Optionen bleiben im bereits bestehenden, per Tastatur erreichbaren Menü für Darstellung und Sprache sowie in der geöffneten Sidebar verfügbar.
- Das Einstellungsmenü im Footer heißt im Agent-Sync-Modus **Darstellung · Sprache**; die eigentliche Agenten-Einstellungsseite behält ihren eindeutigen eigenen Navigationspunkt. Mistral-Modus unverändert.
- Theme-Beschriftungen sind übersetzt (DE/EN/ES/RU), haben explizite Accessibility-Labels und Title-Texte.
- Nur die konkrete erfolgreiche Loginmeldung im **Agent-Sync-Modus** wird nach 6,5 Sekunden ausgeblendet. Fehlermeldungen, Warnungen oder zwischenzeitlich neuere Hinweise werden nicht überschrieben und nicht zeitgesteuert entfernt.
- Keine Änderungen an Rust/Tauri, Keychain, OAuth, Supabase, Geräte-/Projektfreigaben, MCP, lokalen Runnern oder Paketabhängigkeiten.

## Tests des Quellpatches

- Neue Node-Contracttests prüfen Responsive-Breakpoint, weiterhin erreichbares Theme-Menü, zugängliche und übersetzte Theme-Schalter, eindeutige Einstellungsbezeichnung und auf Login-Erfolg begrenztes Toast-Verhalten.
- Echte Headless-Chromium-CSS-Geometrietests: **1040 px: Footer versteckt / Menü sichtbar**, **1380 px: Footer-Raster sichtbar und ohne Überschneidung / Menü sichtbar**.
- TypeScript/Vite mit KatoOS-QA-Frontend-Flag: PASS; Node-Gesamttests **1045/1045 PASS**, keine Fehler/Skips. Hauptbundle hat unverändert eine nicht blockierende >500-kB-Code-Split-Warnung.
- **Wichtige Grenze:** Die Korrektur wurde separat im Quellbranch geprüft, ist **noch nicht** in die weiterhin laufende, ad-hoc signierte native M3-App eingebaut. Kein heimlicher Austausch der persönlichen, angemeldeten QA-Instanz.

## Offene Freigaben

- Native macOS QA-Paketaktualisierung ist **isoliert gebaut und lokal ad-hoc signiert**, jedoch absichtlich nicht gestartet. Die native Sichtabnahme des korrigierten 1040-px-Footers bleibt offen.
- Kein Release 4.0 und keine Notarisierung. Ein ad-hoc signierter Testkandidat ist keine Developer-ID-Distribution.
- MCP-Client-/Device-/Owner-MFA und echter ChatGPT→KatoSync-Git-/Terminaljob weiterhin eigene, offene Gates.
- UI-Kandidaten für späteren Polishing-Review: kompakter Headerstatus, globale Queue-Anzeige bei leerem isoliertem Projektregister, nachrangige Formulare in Projekte und Agenten-Einstellungen.

**Entscheid:** Native, authentifizierte Grundbedienung bestanden; UX-Patch als Quell- und Browsertestkandidat, aber noch keine native Installer-/Produktivfreigabe.

## Isoliertes natives QA-Paket auf SSD vorbereitet

- Der Quellcommit **0604d07ec896ef135de227fa6f9378b4d396fe36** wurde mit kanonischem KatoOS-QA-Feature und unverändertem Rust-Cargo-Lockfile separat zu einer macOS-arm64-App kompiliert: **Tauri Release Build Exit 0**; Rust zeigte lediglich bekannte ungenutzte QA-Funktionswarnungen.
- Das neue Paket liegt ausschließlich in einem zweiten externen SSD-Buildverzeichnis (`ux4-native-polish-20261121/target/release/bundle/macos`) und heißt weiterhin **KatoSync 4.0 KATOOS QA.app**. Es wurde lokal ad-hoc signiert; `codesign --verify --deep --strict` ist PASS. App-Größe circa 91 MB, Bundle-ID wie der bestehende QA-Kandidat; native SemVer weiterhin 2.0.0 – kein 4.0-Release.
- Der neue ausführbare Binärstand unterscheidet sich vom laufenden alten QA-Bundle. SHA-256 des neuen Executables: `c5d527adcd41b98037de1fb66983b2d7f8444eccfeb8aef2d068d62c22476164`. QA-Quellfix und isoliertes Buildziel sind damit reproduzierbar zuordenbar.
- **Bewusst nicht gestartet, nicht installiert und nicht über die laufende App kopiert.** Die bisher angemeldete QA-Version läuft weiterhin unverändert. Wegen identischer Test-Bundle-ID/Keychain-Konfiguration darf nicht unkontrolliert eine zweite Instanz eröffnet werden; vor dem nächsten visuellen Test den bestehenden QA-Prozess geordnet schließen und den neuen Kandidaten separat starten. Noch keine native Sicht-/E2E-Freigabe des neuen Pakets.
- Developer-ID-Signierung, Notarisierung und öffentlicher Installer bleiben **NO-GO**; ad-hoc nur für lokale M3-QA.
