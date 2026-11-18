# Stage 3Y: vollständig isolierte Stage3X-QA-App vor Installation

**02.11.2026 · QA-only · gestapelter Draft auf Stage3X · keine Produktion-/Cloud-Schreibzugriffe**

## Befund vor dem Installieren

Die Stage3X-Bundle-ID `com.nmkato.katosync.meshqa.stage3x` war bereits getrennt. Trotzdem hatte die Build-Variante noch denselben Keychain-Dienst, dasselbe lokale Konfigurations-/Logverzeichnis und denselben macOS-LaunchAgent wie die vorherige `katoos-auth-qa`-Variante. Eine parallele Installation wäre daher nicht ausreichend isoliert gewesen; ein Zugriff auf vorhandene Session- und Projektmetadaten wäre denkbar.

Die neue **explizite** Cargo-Featurekombination `stage3x-qa = ["katoos-auth-qa"]` trennt jetzt alle vier Komponenten:

| Ressource | Stage3X-QA-Grenze |
|---|---|
| Bundle-ID | `com.nmkato.katosync.meshqa.stage3x` |
| Keychain Service | `com.nmkato.katosync.katoos.stage3x.qa` |
| App-Support und Logs | `KatoSync Mesh QA Stage3X` |
| LaunchAgent | `com.nmkato.katosync.meshqa.stage3x.sync` |

Alle bisherigen Services für Stable, GitHub-QA und KATOOS-QA bleiben unverändert. Keine Kopie eines Legacy-/Stage2I-Refresh-Tokens: Die Stage3X-App muss sich **neu am gemeinsamen KATOOS-Konto anmelden**. Auch nach erfolgreichem Login bleiben Mesh-Trust, Session-Transport und Remote-Jobs gesperrt, bis eigene signierte Pairing- und Benutzerfreigabeprüfungen bestanden sind.

## Atomares signiertes Packaging

`scripts/build-mesh-qa-stage3x-macos.sh` führt mit expliziter Signaturidentität die Web- und Tauri-Builds mit `--features stage3x-qa` aus, kopiert ausschließlich die valide signierte Stage2I-Basis in ein temporäres Stage3X-Verzeichnis, ersetzt die neue native Binärdatei, ändert die Bundle-ID, signiert und prüft **zuerst die Kopie**. Erst wenn `codesign --verify --deep --strict` besteht und der Zielpfad weiter frei ist, wird diese nach `~/Applications/KatoSync Mesh QA Stage3X.app` verschoben. Schlägt die Prüfung vorher fehl, wird die temporäre Kopie über den Exit-Trap beseitigt. Stage2I und Stable bleiben unangetastet.

**Live-Abnahme:** Die vorherige Stage3X-Variante wurde erfolgreich nativ kompiliert. Für das neue `stage3x-qa`-Feature besteht der lokale Rust-Test `github_qa_does_not_share_production_keychain_or_data_directory`. Die Node-Regression ist grün. **Eine signierte neue App wurde nicht installiert**, weil der externe Remote-Buildaufruf mit der Developer-ID-Signatur zuvor von einem Sicherheits-Gate zurückgewiesen wurde. Die Unterschrift und Installation benötigen einen verifizierten lokalen signierenden Schritt; sie werden nicht vorweggenommen.

**Vor dem tatsächlichen Test:** M2 hatte zuletzt ungefähr 80 GiB frei; M3 nur rund 11 GiB. Zunächst nur eine fertige signierte App auf M2 erzeugen; kein Rust-Doppelbuild auf M3. Der M3 erhält erst nach M2-Signatur-/App-Start-/Login-Prüfung eine Kopie derselben separat signierten QA-App. Der separat erforderliche KATOOS-Konto-Login und Stage3U-Preflight bleiben manuell, verifizieren Mitgliedschaft aber ohne Cloud-Datenänderung.

### Reproduzierbarer Abschluss auf dem autorisierten M2 (lokal, nur bei tatsächlicher Signaturfreigabe)

In einem bereits vorbereiteten, vertrauenswürdigen macOS-Terminal:

```bash
cd /Users/4gi.tv/Projects/.katosync-mesh-stage3y-qa-isolation-20261102
npm ci --ignore-scripts --no-audit --no-fund
mkdir -p src-tauri/resources/poppler src-tauri/resources/typst
export CARGO_TARGET_DIR=/Users/4gi.tv/Projects/KatoSync/src-tauri/target
export KATOSYNC_QA_SIGNING_IDENTITY="Developer ID Application: MK Heartbeat UG (haftungsbeschraenkt) (T8SB89JPX7)"
bash scripts/build-mesh-qa-stage3x-macos.sh
codesign --verify --deep --strict "$HOME/Applications/KatoSync Mesh QA Stage3X.app"
```

Auf M3 nur bereits signiertes Bundle kopieren, anschließend Identifier, Team-ID, Code-Signatur und Binary-SHA prüfen. **Keine** eigene Signing-Identität oder Schlüssel exportieren und keine alte QA-App löschen.
