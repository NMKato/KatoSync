# Stage 3Z – Installierbare Stage3X-Mac-QA sicher prüfen und Apple-Notarisierung vorbereiten

**02.11.2026 · QA-only · keine produktiven Cloud-/Mesh-Änderungen**

## Festgestellter Sachstand

- Auf dem M2 liegt ein neuer, erfolgreich mit **`stage3x-qa`** gebauter nativer `katosync`-Binärstand unter `/Users/4gi.tv/Projects/KatoSync/src-tauri/target/debug/katosync`; SHA-256 **`580d7b766a3d1280f3f7c23603fea247a595c5ee708602b58b8e20e8e965fdab`**. Der Web-Build mit `VITE_KATOOS_AUTH_QA=1` ist ebenfalls erfolgreich.
- Der native Binärstand enthält nach einer **nur lesenden** statischen Inhaltsprüfung die vier erwarteten Zeichenfolgen: `xbnnlyyxiilklsygxcof.supabase.co`, `com.nmkato.katosync.katoos.stage3x.qa`, `com.nmkato.katosync.meshqa.stage3x.sync` und `KatoSync Mesh QA Stage3X`. Dies ist **kein** Online-Login-Test.
- Die bisherige Stage2I-QA-App auf dem M2 ist Developer-ID-signiert, Team `T8SB89JPX7`. Gatekeeper meldet jedoch **`rejected / Unnotarized Developer ID`**. Auch auf M3 ist Stage3X bislang nicht installiert.
- Der bisherige Stage3X-Signer verwendete `--timestamp=none`. Laut Apple ist ein **sicherer Timestamp** für reguläre notarizierbare Developer-ID-Software erforderlich. Das Skript ist daher auf `codesign --timestamp --options runtime` korrigiert. Stage3X verwendet weiterhin eine eigene Bundle-ID, eigenen Keychain-Dienst und isolierte App-/Startagenten-Verzeichnisse.
- Der M2 ist Build-Maschine (zuletzt ungefähr 79 GiB frei). M3: nur circa 11 GiB frei; **kein** zweiter Rust-Build auf M3.

## Jetzt reproduzierbar: Signatur- und Gatekeeper-Prüfung

`bash scripts/verify-mesh-qa-stage3x-macos.sh` prüft auf dem jeweiligen Mac **ohne Cloud- oder Keychain-Zugriff**: Vorhandensein der alten und neuen App, gültige tiefe Codesignatur beider Apps, Stage3X-Bundle-ID, echtes Developer-ID-Team und Signing-Authority, ausführbare Binärdatei, SHA-256 und Gatekeeper-Beurteilung. Fehlen die Voraussetzungen, schlägt es hart fehl; bei einem nicht notarisierten Bundle meldet es separat `STAGE3Z_GATEKEEPER_ASSESSMENT_REJECTED` (Exit 5). Ein optionales einziges SHA-256-Argument erzwingt auf M3 denselben Binärstand wie auf M2.

**Es werden weder Gatekeeper noch Quarantäne umgangen.** Keine `xattr`-Löschung, kein `spctl --master-disable` und kein Export von Signatur- oder Apple-Account-Schlüsseln.

## Apple-Notarisierung – getrennte, ausdrücklich bestätigte Handlung

`scripts/notarize-mesh-qa-stage3x-macos.sh` ist der **separate** Offline-vorbereitete Notarisierungsschritt. Er startet ausdrücklich **nicht** ohne beide Variablen `KATOSYNC_STAGE3Z_APPLE_UPLOAD_APPROVED=YES_EXPLICIT_APPLE_SUBMISSION` und `KATOSYNC_STAGE3Z_NOTARY_PROFILE=<bestehender-Profileintrag>`. Er verlangt eine signierte Stage3X-App mit Team-ID und sicherem Timestamp; erzeugt danach ein temporäres ZIP, übermittelt es mit `xcrun notarytool submit --keychain-profile ... --wait --output-format json` an Apple, prüft **Status Accepted**, stapelt das Ticket, validiert Signatur und Gatekeeper und löscht das temporäre ZIP. Er wird **nicht automatisch aufgerufen**; für die externe Übertragung des App-Bundles an Apple ist eine ausdrückliche Nutzerentscheidung erforderlich. Ein vorhandener Keychain-Profilname reicht aus; Apple-ID und Passwort werden weder als CLI-Argumente benötigt noch protokolliert.

Apple-Dokumentation: [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow), [Requirements and common notarization failures](https://developer.apple.com/documentation/security/resolving-common-notarization-issues).

## Kontrollierter Ablauf

1. Auf M2: separaten Stage3X-Build aus `scripts/build-mesh-qa-stage3x-macos.sh` **lokal** mit der vorhandenen Developer-ID signieren. Die bereits installierte Stage2I-App wird nicht ersetzt. Der Build-Signer muss einen sicheren Apple-Zeitstempel verwenden; ein Offline-Signieren ohne Timestamp ist nicht notarizierungsreif.
2. Auf M2: die signierte App über `scripts/verify-mesh-qa-stage3x-macos.sh` prüfen. Ein Gatekeeper-Fehler wird nicht als fertige Distributionsabnahme ausgegeben.
3. Ausschließlich nach Zustimmung die Apple-Notarisierung in einem lokalen Terminal mit einem vom Nutzer vorbereiteten `notarytool`-Keychain-Profil durchführen. Ohne `Accepted` und `stapler validate` **kein** Versand an M3.
4. Auf M3: nur die fertig signierte und notarizierte Bundle-Kopie übernehmen. Auf beiden Macs Bundle-ID, Team-ID, Signatur, SHA-256 und Gatekeeper kontrollieren. Die beiden Benutzer melden sich **separat** in Stage3X am gemeinsamen KATOOS-Konto an; bestehende Token werden nicht kopiert.
5. Erst nach erfolgreichem Login die Stage3U-Schaltfläche **KATOOS-Verbindung prüfen** betätigen. Die dadurch bestätigte Membership ist noch **kein** Mesh-Pairing. Gerätefreigabe/SAS, Edge-Relay und Aufträge verlangen eine weitere separate Ende-zu-Ende-Abnahme.

**Beweisgrenze:** Native Stage3X-Binärdatei kompiliert; App-Signatur und Apple-Notarisierung für Stage3X noch **nicht ausgeführt**. Kein Online-Login, keine Verbindung M2↔M3, keine Cloud-Mutation in Stage3Z.
