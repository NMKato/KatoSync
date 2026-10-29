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
