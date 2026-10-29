# KatoSync 2.0: M3-Erstindex und Windows-native QA (29.10.2026)

**Status:** Stacked Draft-PR #175, kein Merge nach `main`, kein öffentlicher Installer.

## Mac M3 – eigenständige lokale Daten

- Neue saubere KatoSync-QA-Git-Kopie auf externer DevSSD erzeugt;
  Git-Stand `48aa01c`, keine modifizierten Dateien.
- Der **alte** lokale KatoSync-Quellordner hat eigene uncommittete
  Änderungen und wurde absichtlich nicht verändert.
- Über die signierte Mesh-QA-App: Projekte → Projekt hinzufügen →
  genau den neuen Git-Ordner auswählen → hinzufügen und prüfen.
- Master-Chat erkennt das registrierte Projekt und die fehlende
  erste Memory-Fabric-Indexierung; explizite Sicherungsbestätigung
  wurde vor der Indexierung über die App gegeben.
- Ergebnis live: `memory-v1.sqlite3`, Schema **v4**,
  `PRAGMA quick_check=ok`, **1** Projekt, **10** indexierte
  Quellen, **0** Turns (frisches eigenes Profil).
- UI meldet `Projektwissen wurde aktualisiert`.
  Keine M2-SQLite-/Keychain-/Chat-Übertragung.
- Der initiale Recovery-Dialog zeigte unzulässig schmal
  umgebrochenen Text neben einer riesigen Checkbox: CSS-
  Korrektur erzwingt 18px-Checkbox und flüssige Textbreite.
  **Diese Korrektur liegt zunächst im Git-Code und ist auf
  dem M3 noch nicht neu signiert/installiert.**
- Eigener Gemma 4 E4B Offline-Modellserver ist noch nicht
  abgenommen. Der im QA-App-Dialog gestartete
  **SHA256-gepinnte** Modell-Installer nutzt per QA-Symlink
  ausschließlich einen neu angelegten Speicherort auf der
  externen DevSSD, denn die interne SSD hat zu wenig Platz.
  Vollständiger SHA-Check, Runtime-Start und Chat-E2E auf M3
  bleiben bis zum abgeschlossenen Installationslauf offen.
  Die externe Platte muss hierfür verbunden bleiben.

## Windows – echte neue QA-Entwicklungsumgebung

- Separates, frisches Git-Checkout im Nutzerprofil, ohne KAI
  Desktop oder bestehende Prozesse zu verändern.
- Windows 11 x64, Rust stable MSVC, Visual Studio 2022,
  WebView2 und Node.js vorhanden.
- `npm ci`, vollständige Node-Regression und
  `npm run build` waren grün.
- Erster nativer Tauri-Build scheiterte an fehlendem
  `src-tauri/resources/poppler`; `typst` fehlt ebenfalls.
  Mac-QA-Bundles verwenden hier derzeit nur `.test-only`-
  Markierungen. Für den Debug-*Kompilierungstest* wurde
  die gleiche Art **explizit gekennzeichneter, nicht
  funktionsfähiger QA-Verzeichnisse** lokal auf Windows
  angelegt. Dies ist KEIN releasefähiger PDF-/Typst-Build.
- Mit QA-Platzhaltern ging die Rust-Kompilierung weiter
  und deckte einen **wirklichen Windows-Codefehler** auf:
  `resume_runner_session` nutzte ungeschützt
  `std::os::unix::fs::PermissionsExt` und
  `Terminal.app`.
- Plattformkorrektur:
  macOS-Implementierung ausschließlich mit
  `#[cfg(target_os = "macos")]` kompilieren;
  alle anderen Systeme beantworten dieselbe Tauri-
  Kommando-API fail-closed mit
  `RESUME_UNSUPPORTED_PLATFORM`.
  Keine falsche Windows-Terminalsession starten.
- Native Windows-Kompilierung nach diesem Patch erneut
  überprüfen; danach erst echten Windows-Installations-,
  Signatur-, Git- und Provider-E2E-Test vornehmen.

## Release-Gates

1. Windows-Packaging **mit tatsächlichen, geprüften**
   Poppler-/Typst-/STT-Ressourcen, nicht mit QA-Sentinels;
   Installersignatur und Auto-Update.
2. Mac M3 Offline-Gemma-Modellstart, neuer Chat-Turn,
   Quellen und gespeicherter Verlauf.
3. Windows Code-Signing, App-Lifecycle, Sessionbindung,
   realer CLI-Read-only-Auftrag und tatsächliche
   plattformgerechte Session-Fortsetzung.
4. Stacked-Draft-PR-Kette kontrolliert integrieren;
   Mesh-SAS und echte mTLS-Abnahme bleiben separat.

Keine fremden Projektdateien, Produktionsdatenbanken,
Benutzerschlüssel oder KAI-Desktop-Anwendungen verändert.

## Ergänzung: native Windows-QA-Abnahme, 29.10.2026

Nach dem macOS-only-CFG-Fix wurde der gesamte Debug-Tauri
Build auf einem realen Windows-11-x64-Rechner mit MSVC erfolgreich
kompiliert. Die App-Datei `target/debug/katosync.exe` wurde
erzeugt und über `Start-Process` geöffnet. Windows meldete
`Responding=True` und den isolierten Fenstertitel
`KatoSync · Mesh QA (isoliert)`. Ein Bildschirmtest zeigte
das echte KATOOS-Login-Gate im nativen WebView2-Fenster.
Es wurden **keine** Zugangsdaten eingegeben; nach dem
Start-Smoketest wurde ausschließlich dieser un-signierte
QA-Debugprozess wieder geschlossen. Die vorhandene
KAI-/THEORG-App sowie deren Modellserver blieben unverändert.

Die Node- und Web-Build-Strecke auf Windows war ebenfalls
erfolgreich, jedoch scheiterte der erste GitHub-Windows-Node-
Job nach dem Commit an einem neuen Regressionstest, der
Unix-Zeilenenden im Git-Quelltext vorausgesetzt hatte.
Der Test für die Resume-Plattformgrenze wurde deshalb auf
robuste Quelltextabschnittsprüfung ohne feste Zeilenendencodierung
umgestellt. Vollständige CI-Reabnahme bleibt bis zum neuen
GitHub-Gate erforderlich.

**Nicht freigegeben:** Der Windows-Debug-Build verwendet
explizite `.test-only`-Platzhalter für fehlende Poppler-/Typst-
Ressourcen. Keine echte PDF-/Typst-Funktion, kein signierter
Installer, keine Update-Signatur, kein authentifizierter
Windows-Agentenauftrag. Der Starttest ersetzt diese Gates nicht.

## M3 echte lokale Chat-Abnahme und Retrieval-Regression (29.10.2026)

**M3 bereits installierte signierte Mesh-QA-App**, frisches eigenes
Projektprofil, frisch indexierte zehn Git-Quellen:

- Verifizierter lokaler Modell-Endpunkt `127.0.0.1:17842/v1/models`
  liefert `kato-local-brain` (Gemma 4 E4B, Q4_0), App meldete
  `Läuft` und einen READY-Test. Kein Cloud-Fallback.
- Testfrage nach dokumentierten Code-Runnern über die **sichtbare
  Master-Chat-UI** eingesendet. Es kam eine Markdown-Antwort mit
  **sieben Quellenverweisen**; SQLite enthielt danach genau
  **einen** neuen Turn. `PRAGMA quick_check=ok`.
- Nach Wechsel zu `Verbindungen` und zurück in `Master-Chat`
  wurde derselbe Turn durch erneute Projektauswahl aus dem
  lokalen Verlauf neu geladen. Kein Projekt-/Chat-Datenverlust.
- **Wissensgenauigkeit noch nicht bestanden:** Obwohl die
  indexierten Quellen `README.md` und `docs/ARCHITECTURE.md`
  ausdrücklich Codex CLI und Claude Code CLI nennen,
  behauptete Gemma im ersten Test, es gebe keine spezifische
  benannte Runner-Liste. Diese unbelegte Negativbehauptung
  darf nicht als erfolgreiche inhaltliche QA gelten.
- Forensisch überprüft: FTS5 enthält mindestens 14 Treffer für
  `Codex` und mindestens 14 für `Claude`. Die Originalfrage
  enthält dagegen 16 überwiegend generische Terme, deren
  BM25-Ranking die präzise Evidenz teilweise verdrängte.
- Code-Fix in `memory_fabric/retrieve.rs`: **nur** bei
  ausdrücklich kombinierten Code-/CLI-Runner-Fragen werden
  generische Fragewörter aus der Suche entfernt und die
  belegbaren Suchkandidaten `codex` und `claude` ergänzt.
  Das erfindet keine KI-Antwort und schreibt keine Projektfakten.
  Andere Fragetypen verwenden weiterhin die vorherige
  Query-Aufbereitung. Rust-Regressions- und echter synthetischer
  SQLite-FTS5-Integrationstest erfolgreich.
- Zur Schonung der knappen internen SSD (zeitweise ca. 2-3 GB
  frei) und hoher macOS-Swaplast wurde das Gemma-Modell
  **über den eigenen Stoppen-Button der App** beendet.
  Die geprüften Modelldateien bleiben auf der externen DevSSD
  und können bei Bedarf erneut gestartet werden.

**Präziser Freigabestatus:** Lokal funktionierende M3-Chat-Strecke
inklusive Reload ist belegt. Der neue FTS5-Code-Fix ist
zunächst ausschließlich im Draft-PR und **noch nicht in der
installierten M3-QA-App**. Ein weiterer realer M3-Antworttest mit
der signiert installierten neuen Version ist notwendig, bevor
die inhaltliche QA als bestanden gilt.

**Windows CI-Nachprüfung:** Der portable Plattform-Regressions-
test wurde auf LF/CRLF-unabhängige Prüfung korrigiert;
die GitHub-PR-Fast-Gates einschließlich Windows Node Regression
waren für Commit `691915f` grün. Native Windows-QA bleibt
durch reale Ressourcenpakete und Freigabe-/Signaturprüfung
begrenzt.
