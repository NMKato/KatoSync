# Stage 4A: Apple-Notarisierung korrigiert und angenommen

**03.11.2026 · KatoSync Mesh QA Stage3X · ausschließlich lokales macOS QA-Bundle**

## Fehlernachweis vom Apple Notary Service

Die erste Stage3X-Einreichung über das nun gültige macOS-Keychain-Profil `katosync-stage3x` wurde mit `Invalid` abgelehnt, obwohl die äußere Anwendung Developer-ID-signiert, mit sicherem Timestamp und Hardened Runtime versehen war.

- Apple Submission: `97ebf949-8feb-4b78-aa5a-ea13f3867e0d`, `Invalid`.
- Genauer Pfad: `Contents/Resources/resources/stt/KatoSyncSpeechHelper.app/Contents/MacOS/katosync-stt`.
- Alle drei Apple-Fehler: **Developer-ID nicht gültig**, **sicherer Zeitstempel fehlt**, **Hardened Runtime fehlt**.
- Eigene Prüfung bestätigte: Die verschachtelte Speech-Helper-App hatte nur eine **Ad-hoc-Signatur** und keine Apple-Team-ID. Die allgemeine `codesign --verify --deep`-Prüfung der Haupt-App hatte diese Unzulänglichkeit nicht aufgedeckt.

Apple verlangt, dass **jede enthaltene ausführbare Komponente** mit gültiger Developer-ID, Timestamp und Hardened Runtime signiert ist. Empfohlen wird die Signatur **von innen nach außen**:
https://developer.apple.com/documentation/security/resolving-common-notarization-issues

## Reparatur und Ergebnis

Die bestehende notarization-rejected Stage3X-QA-App auf dem M2 wurde ausschließlich über das revisionsgesicherte QA-Reparaturskript `scripts/repair-mesh-qa-stage3x-helper-macos.sh` aktualisiert. Eine versteckte **Rollback-Bundle-Kopie** wurde beibehalten. Stable, Stage2I, KATOOS/Auth, Edge-Funktionen und Mesh-Datenbank wurden nicht verändert.

- Speech Helper explizit mit `Developer ID Application: MK Heartbeat UG (haftungsbeschraenkt) (T8SB89JPX7)`, `--timestamp --options runtime` und vorhandener Mikrofonberechtigung aus den App-Entitlements signiert.
- Danach äußere Stage3X-App mit demselben Developer-ID-Team und den vorhandenen Entitlements signiert; beide Signaturen separat geprüft.
- Neue finale Binary-SHA-256: `e2419ad8c1a530b1d37be64dde5fb3e3c59fd8b57653418675da4c802849c1c6`.
- Zweite Apple-Einreichung: `90c7f4d0-616b-45d2-9d39-3daf0fc88bea`, **Accepted** (03.11.2026, 10:33 UTC).
- `xcrun stapler staple` und `stapler validate`: **erfolgreich**.
- `spctl --assess --type execute --verbose=2` auf M2: **`accepted / Notarized Developer ID`**, Exit 0.
- `codesign --verify --deep --strict` für Haupt-App und `codesign --verify --strict` für Helper: **erfolgreich**.
- `open -n -a ~/Applications/KatoSync\\ Mesh\\ QA\\ Stage3X.app` auf M2: Startaufruf Exit 0, nativer Prozess unmittelbar danach sichtbar. Das bestätigt **keinen** längerfristig stabilen UI-Betrieb und **keinen** durchgeführten KATOOS-Login.
- Der dauerhafte Stage3X-Builder unter `scripts/build-mesh-qa-stage3x-macos.sh` signiert ab jetzt den verschachtelten Speech Helper **zuerst**, danach das äußere Bundle, mit jeweils Developer-ID, Timestamp und Hardened Runtime. Stage3X-Feature und getrennte Keychain-/App-Datenräume bleiben erhalten.

## Sicherheit und offene Abnahme

- Apple-Credentials verbleiben im macOS-Schlüsselbund. Keine Passwörter, privaten Signing-Keys oder Tokens wurden ausgegeben/übertragen.
- Es gibt keine neue Netzwerkfreigabe, keine Gatekeeper-Abschaltung, keine Entfernung von Quarantäne-Attributen.
- Stage3X ist auf M2 notarisiert. Auf M3 ist noch die signierte Stage2I-App; das Stage3X-Bundle wurde bisher **nicht** übertragen. Der M3 verfügte zuletzt über ca. 11 GiB freien Speicher.
- M2/M3 Anmeldung über das gleiche KATOOS-Konto und Stage3U Read-Only-Membership-Preflight stehen ebenso noch aus wie Gerätefreigabe, Mesh-Relay und echte Remote-Jobs.
- Die ursprüngliche First-Fail-Submission bleibt in Apples Notarisierungsverlauf als Diagnose bestehen; der anschließende `Accepted`-Eintrag ist der aktuelle gültige QA-Stand.

## Reproduzierbarkeit

Nach dem ersten erfolgreichen Build/Signatur-Lauf kann die vorhandene Stage3X-Test-App bei genau diesem nested-helper-Fall unter Wahrung einer Rollback-Kopie mit `bash scripts/repair-mesh-qa-stage3x-helper-macos.sh` korrigiert werden. Für **neue** QA-Builds ist kein Reparaturschritt mehr nötig, weil die verschachtelte Signatur jetzt im regulären `build-mesh-qa-stage3x-macos.sh` enthalten ist. Anschließend muss jeweils die signierte App erneut von Apple notarisiert und Gatekeeper-getestet werden.
