# KatoSync UX4 – native M3-QA (20.11.2026)

Created by NMKato Solutions. **Private QA only; no production upgrade or KatoSync-4.0 release approval.**

## Verifizierte Ausgangslage

- Ausgangscode: NMKato/KatoSync, Commit **89c8fa30760cbbbb5009c97d9911e436a6d0ca09** (UX4-Facelift).
- Separater QA-Branch: **qa/ux4-native-macos-20261120**. Candidate 11 auf M3 bleibt installiert, signiert und als eigener Prozess aktiv. Die produktive Hauptversion, der C11-Source-Branch sowie das M2-System wurden nicht geändert.
- Host: M3, macOS 27.2, arm64, Xcode 27.0. Projekt, Node-Cache, isolierte Rust-1.95.0-Toolchain und Buildartefakte liegen auf der externen SSD. Das interne M2-Laufwerk wurde nicht für Cargo verwendet.
- Isolierte Tauri-Konfiguration: **src-tauri/tauri.ux4-native-qa.conf.json**, ProductName **KatoSync 4.0 UX QA**, Bundle-ID **com.nmkato.katosync.ux4qa20261120**. Die ausliegende native SemVer bleibt 2.0.0; 4.0 bezeichnet hier den UX-Teststand.
- Native QA-Feature: **github-login-qa** mit eigenem Keychain-Service. Das Stage4J-Feature und dessen Prozess-/Owner-Sitzungssperre wurden nicht umgangen und bleiben im regulären Stage4J-Build unverändert.

## Technische Befunde und Korrekturen

- Die alte, auf die DevSSD ausgelagerte Rust-Installation hatte leere bin-Verzeichnisse. Rustup 1.29.3 wurde von der offiziellen Rust-Distribution geladen, per offiziellem SHA-256-Abgleich geprüft und ausschließlich in einem neuen SSD-Toolchain-Verzeichnis eingerichtet.
- Rust 1.95.0 erzeugte unter macOS 27.2 mit aktivem Release-Stripping eine nicht ladbare Proc-Macro-Dylib (LINKEDIT-Symbolpool nicht auf 8 Byte ausgerichtet). Für den **QA-Build** wurde daher **CARGO_PROFILE_RELEASE_STRIP=none** gesetzt. Originalquelle und Cargo.lock blieben dafür unverändert. Hintergrund: https://github.com/rust-lang/rust/issues/157750
- Beim Kompilieren ohne Stage4J-Feature wurde ein bereits existierender Feature-Gate-Widerspruch gefunden: Die Funktion run_cli_admission_diagnostic_once war unguarded, ihr einziger aufgerufener Adapter jedoch Stage4J-only. Der QA-Branch bindet die Funktion exakt an dieselbe **stage4j-qa**-Compile-Time-Schranke wie ihren Aufrufer. Es wurden keine zusätzlichen IPC-/Shell-/Mesh-Rechte eingeführt.
- Der vorhandene Stage4Y-Sicherheitsvertrag wurde mit einer Regression erweitert: **4/4 PASS**. Er prüft weiterhin Owner-Gate, Einmalbetrieb, feste Fehlerkategorien und das Fehlen zusätzlicher Tauri-Kommandos.
- Paketierte Poppler-/Typst-/SpeechHelper-Ressourcen sind Kopien aus der vorher verifiziert signierten Candidate-11-App auf M3. Es wurden keine Binärressourcen in Git aufgenommen.

## Native Ergebnisse

| Gate | Verifizierter Befund |
| --- | --- |
| Projektklon / Quell-SHA | PASS; ursprünglicher UX-Commit exakt |
| npm ci / TypeScript / Vite | PASS; 1.933 Vite-Module |
| Gesamte Node-Regression auf M3 | **1035/1035 PASS**, 0 Fehler und 0 Skips |
| Cargo / Tauri aarch64 release QA | PASS; Exit 0 mit Build-Flag no-strip |
| App-Paket | PASS; circa 91 MB auf der SSD |
| App-Bundle-ID / Name | PASS; isoliert von Candidate 11 |
| Lokale Ad-hoc-Signatur | PASS; codesign --verify --deep --strict |
| C11-Signatur | PASS; unverändert |
| Native App starten | PASS; separater PID und eigenes Fenster neben C11 |
| Nativer WebKit-Start | PASS; helles Anmeldefenster ohne Absturz; tatsächliche Fenster-ID/PID unabhängig geprüft |
| Agent-Sync nach Anmeldung / reales Mesh / MCP | **OFFEN; gesonderte persönliche Anmeldung und Freigaben erforderlich** |
| Developer-ID-Signierung / Notarisierung / Installationsfreigabe | **OFFEN; Ad-hoc ist keine Distributionssignatur** |

Die native QA-App ist lokal auf der externen SSD gebaut und gestartet. Da sie absichtlich keine vorhandene private Sitzung oder Keychain-Daten übernimmt, zeigt sie den Login-Screen. Der Owner muss sie persönlich anmelden, bevor die eigentliche Agent-Sync-Oberfläche in der nativen WebKit-Laufzeit mit echten Gerätedaten geprüft werden kann. Keine Tokens, Passwörter, MFA-Codes oder Projektinhalte wurden kopiert oder in einem Testbericht gespeichert.

## Reproduktion (isolierte QA)

1. Freigegebenen UX4-Quellcommit verwenden und die Stage4Y-gated Compilerkorrektur dieses QA-Branches übernehmen.
2. Node 22, Rust 1.95.0 und Xcode mit Verzeichnissen auf einer SSD einrichten. CARGO_HOME, RUSTUP_HOME und CARGO_TARGET_DIR auf die isolierten SSD-Verzeichnisse setzen.
3. Bisher bereits signierte C11-Bundle-Ressourcen im privaten QA-Arbeitsverzeichnis ergänzen (Poppler, Typst, SpeechHelper). Keine Ressourcen nach Git hochladen.
4. npm ci und npm run build ausführen.
5. CARGO_PROFILE_RELEASE_STRIP=none setzen und Tauri mit dem QA-Configpfad, Feature github-login-qa, --no-sign, --bundles app, --ci und Cargo --locked bauen.
6. Nur für die lokale QA-App ein Ad-hoc-Codesign ausführen; Bundle-ID, Signatur, Prozess, Fenster und unveränderte C11-Signatur nachprüfen.
7. Erst nach persönlicher Anmeldung Hell/Dunkel/Auto, 4+3-Cards, echte Statusanzeigen, Onboarding, Device-/MCP-Detailaufrufe, Fenstergrößen und Quit/Rollback nativ abnehmen.

**Nicht freigegeben:** direkter Remote-Desktop-Commander-Ersatz, produktive Remote-Git-/Terminalbefehle, Serieninstaller oder Merge nach main.

## Nachtrag 20.11.2026 – ursprünglicher UX4-QA-Login ersetzt

Die in diesem Dokument zuerst gebaute native QA-App (`github-login-qa`) war **kein gültiger Test des bestehenden KatoOS-Kontos**: Sie verwendete den historischen KatoSync-Auth-Issuer und ein unpassendes Frontendflag. Der persönliche Login schlug mit HTTP 400 fehl. Das isolierte Folgepaket `KatoSync 4.0 KATOOS QA.app` verwendet nun den korrekten KatoOS-/KSP-Issuer mit neuem, eigenem Schlüsselbund- und Daten-Namensraum. Die fehlerhafte Vorgänger-QA wurde beendet. Siehe [KatoOS-Loginfix](KATOSYNC_UX4_KATOOS_AUTH_FIX_20261120.md). Der erste Buildnachweis bleibt als historische Evidenz erhalten, darf aber nicht als erfolgreicher KatoOS-Login interpretiert werden.
