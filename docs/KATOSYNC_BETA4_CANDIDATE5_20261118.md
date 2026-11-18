# Beta4 Candidate5: Paket- und Laufzeitnachweis

Created by NMKato Solutions

Stand: 2026-11-18, 23:04 UTC.

## Ergebnis und Abnahmegrenze

Candidate5 ist aus dem eingefrorenen Quellstand gebaut, mit Developer ID signiert,
von Apple akzeptiert und mit dem Notarisierungsticket versehen. Dasselbe geprüfte
ZIP wurde auf M2 und M3 installiert. Beide Rechner führen tatsächlich das neue
Candidate5-Bundle mit der eingebetteten Build-Source aus; es handelt sich nicht
nur um eine geänderte App-Verknüpfung.

Die technische Paketierung ist abgeschlossen. Die persönliche MFA-Einrichtung,
die getrennten Client- und Gerätefreigaben sowie der erste signierte Live-Auftrag
aus ChatGPT bleiben ausstehende Abnahmeschritte. Der reine Start beweist weder
den App→Worker-Lesestatus noch einen ausgeführten Git- oder Terminalauftrag.

## Eindeutige Build-Bindung

| Merkmal | Verifizierter Wert |
| --- | --- |
| Paketquellstand | `a806ebc2825a5548928779dbf8c9d5648b4ce88e` |
| Quellzweig | `fix/beta4-mcp-adapters-20261118` |
| Workflow | `.github/workflows/beta4-native-macos.yml` |
| Genau ein Package-Lauf | [44411213526](https://github.com/NMKato/KatoSync/actions/runs/44411213526) |
| Eingabe | `build_package=true` |
| Ziel | `aarch64-apple-darwin`, Debug-Profil |
| GitHub-Artefakt-ID | `14476584780` |
| Artefaktname | `beta4-prebuilt-a806ebc2825a5548928779dbf8c9d5648b4ce88e-aarch64-apple-darwin-debug` |
| Eingebauter Relay-KID | `katosync_beta4_relay_20261118c` |

Ein nachfolgender Dokumentationscommit verändert die eingebettete Source nicht.
Die Paketzuordnung bleibt ausdrücklich der oben genannte Code-Commit.
Der Laufzeitnachweis bindet den tatsächlichen Prozess und dessen Executable an
das genaue Candidate5-Bundle und liest dort die signierte Ressource
`Contents/Resources/katosync-build.json`, Feld `sourceCommit`.

## Tatsächliche Prüfungen

- Vollständige native Testsuite im Package-Workflow: **505 bestanden, 0 fehlgeschlagen,
  8 bewusst ignoriert**. Die Tests liefen in der tatsächlichen Tauri-Komposition.
- Die nativen Prüfungen umfassen unter anderem den festen realen Git-Prozess,
  das Abbruchrennen während einer MFA-Bestätigung, Signatur-/Hash-Kompatibilität
  der Connector-Fixture, Ablauf-/Replay-Ablehnung sowie den sensitiven
  WebSocket-Authorization-Header und die feste Zielbindung.
- **21 gezielte Frontend-Vertragstests bestanden.** TypeScript-Prüfung und
  Produktions-Webbuild bestanden; die bekannte Chunk-Größenwarnung bleibt
  eine Warnung.
- Rust-Formatprüfung und `git diff --check` bestanden.
- Unabhängige Quellprüfung deckte native Einmalzustimmung, Abbruchbehandlung,
  IPC-/Relay-Komposition und den engen WSS-Header-Fix ab.
- Der lokale kalte Harness wurde während des Abhängigkeitsbaus beendet, um
  denselben vollständigen Build nicht doppelt auszuführen. Ihm wird kein
  bestandener Testlauf zugeschrieben; maßgeblich ist der erfolgreiche native CI-Lauf.

## Signierung, Apple-Annahme und Hashes

Die Paketierung verwendete den vorhandenen Beta4-Build-/Signierweg und geprüfte
Laufzeitressourcen. Der Ressourcenaudit bestand für 29 Poppler-Dylibs,
drei Laufzeit-Binärdateien und vier Lizenzdateien.

| Nachweis | Wert |
| --- | --- |
| Signaturidentität | Developer ID Application: MK Heartbeat UG (haftungsbeschraenkt) |
| Apple-Team-ID | `T8SB89JPX7` |
| Notarisierungsstatus | **Accepted** |
| Notarisierungs-ID | `12864c78-fa00-4109-9260-4e0722557bc7` |
| Codesign, Staple, Gatekeeper | bestanden, einschließlich Prüfung nach Installation auf M3 |
| Größe des Stapled-ZIP | 54.232.643 Bytes |

| Datei beziehungsweise Prüfgegenstand | SHA-256 |
| --- | --- |
| Heruntergeladenes GitHub-Artefakt-ZIP | `c1a00768e727d7178f555666d3cd2c96cb60b96e33a46cbaf5f189feb7e19dbc` |
| Unsigned native Binärdatei | `62652e1e06b7bcf6c48bf422304ce2f90849aed67f8fe9bf40d1d664aeba7051` |
| Signierte installierte Binärdatei | `969bdf9598c2db603c153066c3ae4b8cb80dff2f28bcd909085c3e8cf4d0e15f` |
| Identisches Stapled-ZIP für M2 und M3 | `f30205a650447fd601db20e746492fa63e18eca1aad3b6a8ce814b7a27a00eca` |
| Geprüfter lokaler Ressourcen-Lock | `ca77da9f1127bcb7e56fb96c59dd54d337340b2ef787b6b0cc6b09a3c72ee66d` |

Private Schlüssel, CLI-Anmeldedaten und private Maschinenpfade sind kein
Bestandteil dieses Berichts. Das Paket wurde über den bestehenden privaten
Transferweg verteilt; es wurde kein öffentlicher Release angelegt.

## Installation und tatsächlicher Prozessstart

| Gerät | Installation | Laufzeitnachweis |
| --- | --- | --- |
| M2 | Candidate5 separat installiert; vorhandene Beta4-Verknüpfung nach Prüfung umgestellt; Candidate4-Bundle erhalten | Neuer Prozess am genauen Candidate5-Bundle, eingebettete Source `a806ebc`; um 23:01:09 UTC erneut bestätigt; kein Candidate4-Prozess mehr |
| M3 | Dasselbe ZIP und dieselbe signierte Binärdatei unabhängig geprüft; Verknüpfung umgestellt; Candidate4-Bundle erhalten | Neuer Prozess am genauen Candidate5-Bundle, eingebettete Source `a806ebc`; um 23:00:04 UTC erneut bestätigt; kein Candidate4-Prozess mehr |

Die Umstellung verwendete den normalen AppKit-Beendenpfad. Es gab keine
erzwungene Beendigung und keine Änderung an macOS-Berechtigungen. Die bestehende
Stage4R-Instanz auf M3 blieb unverändert aktiv; dies wurde gesondert über die
Prozesstabelle geprüft.

Die vorhandene Accessibility-Berechtigung erlaubte eine begrenzte lesende
Fensterprüfung. Am neuen Kandidaten wurden keine Modal-, Speichern- oder
Abbrechenhinweise festgestellt. Die Verbindungen-Navigation ließ sich in dieser
begrenzten Prüfung nicht sicher identifizieren. Ein eingeloggter Zustand oder
ein erfolgreicher App→Worker-Leseaufruf wird daher ausdrücklich nicht behauptet.
MFA-, QR- und Codeinhalte wurden nicht übernommen.

## Persönlicher nächster Schritt

1. Im gestarteten Candidate5 die Authenticator-Einrichtung beziehungsweise die
   persönliche Anmeldung abschließen. Codes bleiben ausschließlich in der App.
2. ChatGPT-Client und aktuelles Gerät getrennt freigeben; Git-Lesezugriff und
   bei Bedarf `terminal.run_profile` ausdrücklich wählen.
3. Registrierte Projekte auswählen und die native Verbindung starten.
4. Einen echten `katosync_git_status`-Aufruf ausführen und das signierte
   Geräteergebnis prüfen.
5. Für das feste Profil `git_version` eine frische einzelne Freigabe erteilen
   und die angezeigte Auftrags-ID innerhalb der Frist einmal verwenden.
   Erst ein verifiziertes Ergebnis belegt die CLI-Ausführung.

Allgemeine Terminalbefehle, frei wählbare Shell-Kommandos, Screenshots und
Computer-Use-Eingaben sind damit nicht freigegeben oder fertig implementiert.
Der genaue implementierte Umfang und die deutschen Bedientexte stehen im
[nativen Profilbericht](BETA4_TERMINAL_PROFILE_NATIVE.md).
