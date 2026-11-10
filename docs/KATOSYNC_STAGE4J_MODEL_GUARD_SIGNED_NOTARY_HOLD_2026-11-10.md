# KatoSync Stage4J — Modellschutz-Build signiert, Notarisierung gesperrt

**Datum:** 2026-11-10, Europe/Berlin
**Scope:** Interne QA-Version aus festem Quellstand; keine Installation, kein Mesh-Live-Pairing und kein öffentlicher Release.

## Nachgewiesener Quell- und Buildstand

- QA-Branch: `qa/stage4j-resources-20261109`.
- Exakter Quell-Commit des signierten Programms: `bf780caad368b1ed9c9185149001445ab988be8c`.
- Native Stage4J-Feature: `stage4j-qa`; eigene Bundle-ID `com.nmkato.katosync.meshqa.stage4j-isolated`; Anzeige `KatoSync 4J Model Guard QA`.
- Unveränderte bestehende Stage35- und SingletonFixedQA-Apps, getrenntes QA-Output-Verzeichnis `~/Applications/.KatoSync-Mesh-Stage4J-ModelGuardQA`.
- Echt gebündelte Poppler-/Typst-/STT-Ressourcen und 29 lokale dylibs vor dem Build geprüft; `STAGE4J_LOCAL_RESOURCE_AUDIT_PASS`.
- `npm run build` und nativer Debug-Tauri-Build bestanden, `STAGE4J_NATIVE_NAMESPACE_AUDIT_PASS`.
- Developer-ID-App-Signatur mit Team `T8SB89JPX7` und `codesign --verify --deep --strict` PASS.
- Im ausgeführten Programm durch `strings` nachgewiesen: `Local-Brain-Port 17842 ist durch einen anderen Dienst belegt` – aktueller Modellschutz-Build, nicht eine ältere unveränderte QA-Version.
- Signierter ARM64-Programm-SHA-256 `d7cc147c2a0613957f3924ef3bd8c5b449168c975cf8bf3f82bbdb7605fb5a22`.
- ZIP zur Apple-Notarisierung mit `ditto -c -k --keepParent` erstellt und `unzip -tqq` geprüft. ZIP-Bytezahl **52.806.288**; SHA-256 `bbbfcf1d680933cd7d2343ddf660f145b1da8f07850633401debb4f2b7e2809f`.

## Apple-Notarisierung: Blocker, kein Freigabeversuch über Ersatzidentität

- `xcrun notarytool submit --keychain-profile katosync-stage3x --wait --output-format json` brach lokal mit Exit-Code **69** ab: `No Keychain password item found for profile: katosync-stage3x`.
- Dasselbe Profil konnte auf M2 und M3 auch bei lesendem `notarytool history` nicht gefunden werden. Auf beiden Macs ist ein Benutzer-`login.keychain-db` registriert. Es wurden **keine Schlüsselbund-Passwörter oder App-specific Secrets ausgelesen**.
- Der Apple-Upload ist daher **nicht nachweislich eingereicht oder akzeptiert**; keine Apple-Notarisierungs-ID, kein Stapling.
- Erwartungsgemäß: `spctl --assess` **rejected / Unnotarized Developer ID**. Dies ist kein Codesignatur-Fehler.
- Der signierte ModelGuardQA-Kandidat wurde **weder auf dem M2 gestartet noch auf den M3 verteilt**. Die bereits auf beiden Macs laufende SingletonFixedQA-Binärdatei bleibt die zuletzt live getestete Version.

## Wiederaufnahme ohne Codeänderung

1. Eine berechtigte Person richtet das Notarisierungsprofil `katosync-stage3x` im **lokalen macOS-Keychain** interaktiv neu ein. Niemals das App-spezifische Apple-Passwort in ein Chatfenster oder Shell-Kommandoargument übertragen.
2. `xcrun notarytool history --keychain-profile katosync-stage3x` muss wieder erfolgreich autorisieren.
3. Exakt das bereits geprüfte ZIP mit unverändertem SHA-256 an Apple senden. Nur bei `Accepted` das Ticket in die zuvor signierte App stapeln, Gatekeeper & Codesignature erneut prüfen und danach ein neues **post-staple** ZIP erzeugen.
4. Erst dieses ZIP über einen kurzlebigen, gepinnten TLS-Weg an den M3 übertragen; Größe, SHA-256, Ticket, Gatekeeper und exakt denselben nativen Binary-Hash auf dem M3 verifizieren.
5. Kein automatischer Versionswechsel: die laufende SingletonFixedQA-App besitzt dieselbe Bundle-ID. Ihr sicherer Handoff muss vor dem Öffnen der neuen App durch den Benutzer bestätigt werden, um keine In-Memory-Jobs zu verlieren.
6. Gemma- und Qwen-Modell-Residency, echte SAS-Freigabe, Mesh-Agenten und öffentliche Veröffentlichung sind **separate, nicht erfüllte Abnahmegates**.

## Abschlussregression

- `npm test`: **866/866 bestanden**, **0 Fehler**.
- Gezielte Stage4J-Modell-/Singleton-/Release-/Isolation-Verträge: **21/21 bestanden**.
- Shell-Build-Syntaxprüfung: **PASS**.
- Die native Rust-Portprüfung und zwei native Single-Instance-Verträge waren im vorangegangenen QA-Zyklus erfolgreich; der signierte Kandidat wurde aus dem darauffolgenden gepinnten Quellstand neu gebaut.
- Kein produktiver Prozess wurde durch die Abnahme gestoppt.

**Entscheidung:** `STAGE4J_MODEL_GUARD_SIGNED_BUILD_PASS` und `APPLE_NOTARIZATION_BLOCKED_MISSING_KEYCHAIN_PROFILE`. Nicht installieren oder starten.

Created by NMKato Solutions

## Auflösung des historischen Notarisierungs-Blockers (10.11.2026)

Das zuvor fehlende Keychain-Profil wurde interaktiv neu eingerichtet. Apple hat das unveränderte Paket akzeptiert; Ticket, Gatekeeper und beide physischen Macs wurden erfolgreich nachgeprüft. Der oben beschriebene Hold dokumentiert den **historischen Zwischenstand**, nicht den aktuellen Paketstatus. Aktuelle Abnahme siehe [Stage4J ModelGuard Apple Accepted Two-Mac](KATOSYNC_STAGE4J_MODEL_GUARD_APPLE_ACCEPTED_TWO_MAC_2026-11-10.md). Die neue App bleibt bis zum kontrollierten Ein-Instanz-Handoff nur staged.
