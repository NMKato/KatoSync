# KatoSync 4.0 — One-click Agent Setup, gebündelte Runtime und Desktop-Widget

**Entscheidung 04.11.2026. Tracking: Epic #224, Setup-/Widget-Gate #226. Dies ist ein Zielzustand, kein Release-Nachweis.**

## Gewünschter Produktablauf
1. Der App-Installer enthält eine passende, signierte und SHA-verifizierte llama.cpp-Runtime samt aller Bibliotheken und Lizenz-/NOTICE-Dateien. Große Modellgewichte gehören nicht standardmäßig in den Installer.
2. Ein Knopf **„Setup starten“**: Hardware-/RAM-/Disk-Check, explizite Zustimmung zum Modell-Download, gepinnte URL, wiederaufnehmbares Staging, SHA-/Größenprüfung, atomische Installation, dann Runtime-/Health-/Modell-Alias-Probe. Echte Downloadbytes/Phasen statt erfundener Prozente.
3. Nach abgeschlossenem Setup Meldung „Lokales Modell bereit“. Mit dem nächsten Agent-Birth-Schritt wird daraus nach echtem lokalem Tool-Call, ausgewählter Persona und dauerhaftem Agentenprofil ein **erwachter Agent**. Installiert ist nicht gleich erwacht.
4. Danach Hauptfenster wahlweise minimieren/ausblenden; sparsamer Status-/Watchdog-Dienst läuft weiter, ohne Gemma permanent in RAM zu halten. Erst nach gesichertem Rückweg zur App darf die Oberfläche automatisch ausgeblendet werden.
5. Eigenes kleines, **frei verschiebbares Desktop-Widget** für M2/M3/Windows: aktueller verifizierter Job, Warteschlange, Modell-/Agentenzustand, nachvollziehbare Stale-Meldung, Schnellauswahl Jobs/Chat/Agenten und **Mehr → KatoSync**.
6. Widget-Position lokal merken und nach Monitor-/DPI-Wechsel sicher einklemmen. Start mit dem System und Always-on-top sind Opt-ins. Private Tasktitel nur nach bewusster Detailfreigabe; niemals Credential, Dateipfade oder Projektchats anzeigen.
7. Bei vollständigem Quit Widget und Watchdog beenden; bei Minimieren läuft der sparsame Controller weiter. Schlafmodus/Akkustand/RAM-Druck ehrlich behandeln, keine falsche Echtzeit-Erreichbarkeit.

## Technischer Ist-Stand
- Local-Brain in Rust installiert Runtime und Gemma heute nach explizitem Install-Klick, prüft Gewichte kryptografisch und startet den eigenen llama.cpp-Prozess. Das ViewModel verkettet bereits installLocalBrain → startLocalBrain → registerLocalBrainProvider.
- Der App-Bundle-Vertrag enthält bisher Poppler, Typst und STT, **nicht** das llama.cpp-Runtime-Verzeichnis. Die aktuelle Produktapp liefert die Runtime also noch nicht vollständig selbst mit.
- M2 hat ein altes llama.cpp b11272 Release-Paket von ungefähr 67 MB und 60 Dateien (dynamische dylibs, LICENSE, tiny launcher). Alle dynamischen Bibliotheken gehören dazu, nicht nur die 49-KB-Executable. Bundling erst nach Laufzeit-/Lizenz-/Notarisierungs-/Supply-Chain-Abnahme.
- Gemma-Modell und Vision-Projektor auf M2 sind hash- und größenverifiziert, aber derzeit nicht in der isolierten Stage35e-App aktiviert. M3 hat bei letzter Prüfung ca. 8,3 GiB frei: kein automatischer 5-GB-Modell-Download vor Speicherplan.
- Ein Fensterschließen blendet die derzeitige App bereits aus. Ein eigener Wiederöffnungsweg via Widget/Tray fehlt noch; daher keinesfalls automatisch minimieren, bevor dieser funktioniert.
- Modell-Redistributionsstatus im Release-Manifest steht auf pending_review. Kein öffentliches Model-/Runtime-Repackaging allein aufgrund vorhandener lokaler Dateien.

## Abnahme / Sicherheit
- BundledRuntime=Ready nur bei vollständigem, zur Plattform passendem, signiertem Bundle mit prüfbaren Hashes/Lizenzen und Hardened Runtime. Bei fehlender freigegebener Runtime ehrlicher Zustand statt stiller Netzinstallation.
- Download: explizite Nutzeraktion, RAM-/Plattenreserve und Kosten-/Größenanzeige, sichere Wiederaufnahme, Cancel, SHA, Rollback und Offline-Neustart.
- Desktop-Widget: nur lokale Leseinformationen und UI-Navigation. Keine Job-Starts, Remote-Writes, Keychain- oder Trust-Updates; stale nach Unterbrechung, kein trügerisches Online-Label.
- UI: App-/Widget-Permissions und Screenreader/Tastatur/Bewegung/Position auf M2, M3 und Windows verifizieren.
- Agentenframework OpenClaw benötigt weiterhin Version/Lizenz/Sandbox/Supply-Chain-/Tool-Allowlist-Abnahme.

**Nächster Slice:** Isolierter Setup-/Widget-Prototyp im Draft-Branch. Produktive Agent-Installation erst nach den obigen Runtime- und Modell-Rechtsgates.

## Implementierter erster QA-Slice am 04.11.2026

- Separates, opt-in aktiviertes Tauri-Fenster mit eigener `widget.html`-Entry, ruhiger dunkler Oberfläche, sichtbarem echten Job-/Queue-/Modell-Zustand, Toggle für private Tasktitel, Schnellwahl Jobs/Chat/Agenten und „Mehr → KatoSync“.
- Bewegbares Fenster mit abgesicherter, lokaler Positionsspeicherung und Wiederherstellung auf dem primären Bildschirm. Widget verbergen/Schließen zeigt die Haupt-App wieder an; keine unsichtbare, unbedienbare Zwei-Fenster-Situation.
- Die Haupt-WebView sendet begrenzte in-memory Statusprojektionen. Nach 90 s ohne aktualisierten UI-Status wird `stale` angezeigt. Für einen späteren dauerhaft aktuellen Hintergrund-Jobstatus ist **native Worker-Statusversorgung** statt dauerhafter WebView-Timer notwendig; noch nicht implementiert.
- Backend-IPC bindet `publish` ausschließlich an `main`, `snapshot`/Drag/Hide/Navigation ausschließlich an `desktop-widget`. Navigation ist auf Dashboard/Jobs/Chat/Agenten begrenzt. Die Widget-Erstellung ist bewusst **nur mit Stage35-QA-Feature** erlaubt. Vor allgemeinem Release ist ein zusätzlicher Sicherheitsreview des Tauri-Custom-Command-Scopes erforderlich.
- Local-Brain-Resolver erkennt optional eine im signierten Bundle abgelegte Runtime mit passendem Lock (Version, OS/Arch, Upstream-Archiv-Hash, Binär-SHA-256, LICENSE) und nutzt andernfalls die bisherige separat installierte Runtime. Das Standard-Bundle wurde **nicht** geändert. Ein separater Build-Config-Merge aktiviert das Bundling erst nach vorgelagerter Lizenz-/Signaturprüfung.
- Offline-Packager kontrolliert Archiv-SHA, sichere Extraktion, Anzahl/Größe, dylib und Lizenz; opt-in Freigabe ist zwingend. Kein Modell-/Runtime-Archiv wurde öffentlich ins Git-Repository geschrieben. Keine Binary-Distribution freigegeben.

**Testergebnis:** 660/660 vollständige Node-Tests grün, 267 native Rust-Library-Tests grün (8 ignoriert), 6/6 Python-Packager-Sicherheitstests und TypeScript/Vite-Multipage-Build grün. **Noch keine** tatsächliche Widget-GUI-Abnahme auf signierten/notarisierten M2-/M3-Builds. OpenClaw und Modellbereitstellung/Agent Birth bleiben unverändert offen.

Tracking: https://github.com/NMKato/KatoSync/issues/226 (Teil von https://github.com/NMKato/KatoSync/issues/224).
