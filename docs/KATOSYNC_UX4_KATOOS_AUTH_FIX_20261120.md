# KatoSync UX4 – KatoOS-Loginfix (20. November 2026)

Created by NMKato Solutions. Privater QA-Build. **Keine Freigabe für ein produktives KatoSync-4.0-Release.**

## Befund und Ursache

Im ersten nativen UX4-QA-Build erschien die ältere KatoSync-Eigenregistrierung. Ein bereits bestehendes KatoOS-/KSP-Konto erhielt beim manuellen Login die Meldung **400 Bad Request**. Der Code-Vergleich zeigte einen eindeutigen Buildprofil-Fehler:

- Ursprünglicher nativer QA-Build: Cargo-Feature `github-login-qa`, damit historischer KatoSync-Auth-Issuer.
- Candidate 11 und die aktuell vorgesehene KatoOS-Anmeldung: Cargo-Feature `katoos-auth-qa` mit dem kanonischen KatoOS-Supabase-Issuer.
- Zusätzlich war die Frontendvariable `VITE_KATOOS_AUTH_QA=1` im ursprünglichen QA-Build **nicht** gesetzt. Deshalb bot die Oberfläche eine irreführende neue Registrierung und einen ungeeigneten Logintext an.
- **Wichtig:** HTTP 400 allein beweist keinen ungültigen Benutzer oder falsches Passwort. Die reale Antwort des alten Issuers wird im Client bewusst nicht mit vertraulichen Daten ausgegeben. Die Profilabweichung ist unabhängig davon quellenbasiert bewiesen.

## Korrektur mit privater Isolation

- Neues Cargo-Feature `ux4-auth-qa` erweitert `katoos-auth-qa`, ohne das produktive Standardfeature oder Stage4J zu verändern.
- Eigenständige Schlüsselbunddienste für native KatoSync-Anmeldung und GitHub App: `com.nmkato.katosync.katoos.ux4.qa`, getrennt von Stage4J und allen älteren QA-Sitzungen.
- Eigener lokaler Daten-/Log-Namensraum: **KatoSync UX4 KATOOS Auth QA**. Eigenständiger Launch-Agent-Namensraum (QA only).
- Eigenständige macOS-App: **KatoSync 4.0 KATOOS QA**, Identifier `com.nmkato.katosync.ux4katoosqa20261120`. Die alte fehlerhafte UX4-QA- und die funktionierende Candidate-11-Bundle-ID bleiben unverändert.
- Frontend-Build mit `VITE_KATOOS_AUTH_QA=1`: Im Anmeldefenster steht nun „Mit deinem bestehenden KATOOS-/KSP-Konto anmelden“. Der eigene Registrierungs- und Passwort-Reset-Pfad wird im QA-Frontend nicht angeboten.
- Reproduzierbarer, fail-closed QA-Build: `scripts/build-ux4-katoos-auth-qa-macos.sh`, gekoppelte Frontend-/Rust-Flags, nur Pfade unter /Volumes, `--locked`, `--no-sign`. Für macOS 27 wird `CARGO_PROFILE_RELEASE_STRIP=none` verwendet.
- Keine Passwort-/MFA-/Tokenmigration, keine automatische Kontoanmeldung, keine SQL-Manipulation, keine Änderungen an produktiven Daten oder Freigaben.

## Verifikation und Grenzen

| Abnahme | Verifizierter Befund |
| --- | --- |
| KatoOS-Quellfeature + UX4-Isolation | PASS |
| Gezielte QA-/Auth-Tests | **21/21 PASS** |
| Stage4J- und UX4-Isolationstests | **12/12 PASS** |
| Vollständige Node-Regressionssuite | **1041/1041 PASS**, null Fehler oder Skips |
| TypeScript + Vite mit KatoOS-Frontendflag | **Exit 0**, 1.933 Module |
| Rust + Tauri mit `--features ux4-auth-qa` | **Exit 0**, macOS-Arm64-Releasebundle |
| App-ID und lokale Ad-hoc-Signatur | PASS; eindeutig isoliert und `codesign --verify --deep --strict` |
| Native WebKit-Anmeldeoberfläche | PASS; korrekter KatoOS-/KSP-Text, keine Registrierungsoption, Screenshot geprüft |
| Candidate 11 | PASS; Signatur geprüft und Prozess unverändert |
| Fehlerhafte Vorgänger-QA | Gezielt beendet, keine Datenübernahme |
| **Login mit echten Zugangsdaten** | **Noch nicht getestet** – nur persönlich im neuen QA-Fenster |
| MCP-Client-/Geräte-MFA und Agent-Sync-E2E | Offen |
| Developer-ID-Notarisierung / offizieller Installer | Offen |

**Nächster Schritt:** Auf dem M3 im bereits geöffneten Fenster „KatoSync 4.0 KATOOS QA“ mit dem bestehenden KatoOS-/KSP-Konto anmelden. Zugangsdaten und MFA-Codes bleiben ausschließlich in der App. Nach erfolgreicher Anmeldung native Facelift-Karten, Hell/Dunkel/Auto, Onboarding und getrennte Gerätezustände überprüfen. Der behobene falsche Auth-Issuer allein beweist noch keinen erfolgreichen persönlichen Login.
