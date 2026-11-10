# Stage4J – abgesicherter ModelGuard-Versionswechsel auf M2 und M3

**Stand:** 10. November 2026. **Umfang:** private QA; keine öffentliche Freigabe.

## Nachgewiesene Ausgangslage

- Die Apple-notarisierte ModelGuard-Version ist auf beiden Macs signiert, gestapelt und von Gatekeeper akzeptiert. Haupt-Binär-SHA-256: d7cc147c2a0613957f3924ef3bd8c5b449168c975cf8bf3f82bbdb7605fb5a22.
- M2: bisherige SingletonFixedQA-App läuft mit PID 48795. M3: bisherige SingletonFixedQA-App läuft mit PID 39937.
- Auf beiden Macs: Stage4J-Local-Control inbox und running ohne Job-Dateien, keine lokale Daemon-state.json und keine lanes.json; kein KatoSync-Local-Brain-Listener auf Port 17842.
- Beide signierten QA-Apps besitzen dieselbe Bundle-ID. Der native Instanzkoordinator verweigert Doppelstarts. Ein AppleEvent-Quit nur nach Bundle-ID wäre mehrdeutig und wird nicht verwendet.

## Sicherer QA-Übergabehelfer

**Skript:** scripts/qa-stage4j-owner-approved-modelguard-handoff.sh

- Standardmodus --preflight: nur lesende Prüfung der exakt bekannten Installationspfade, Developer-ID-Team T8SB89JPX7, Code-Signaturen, Bundle-ID, Gatekeeper, Paket-Hash, tatsächliche Einzelprozess-ID, Local-Control-Jobs und Modellport.
- Beide physische Mac-Vorabtests: STAGE4J_HANDOFF_PREFLIGHT_PASS. Identische Skript-SHA-256 auf M2 und M3: a7fdcd559799ec59be6446822baba3eccc5ad46537cda877a2dc8395def1cbc1.
- Modus --owner-confirmed-handoff: dialogbasierte ausdrückliche Eigentümerfreigabe. Die Standardauswahl ist Abbrechen; nach 45 Sekunden läuft der Dialog sicher ab. Warnung vor ungespeicherten GUI-Entwürfen.
- Nach Bestätigung erneut Prozess und Jobs prüfen, nur den nativen Menüpunkt Quit KatoSync 4J Single Instance Fixed QA am einzigen exakten Prozess anklicken, dessen Exit abwarten, sicherstellen, dass keine andere KatoSync-App läuft, und erst dann die neue ModelGuard-App einmalig öffnen.
- Kein SIGTERM, SIGKILL, pkill, killall, kein Austausch laufender App-Binärdateien, kein unbestätigter Quit und kein App-Event an die gemeinsame Bundle-ID. kill -0 wird ausschließlich für die passive Existenzprüfung einer bekannten PID verwendet.
- Keine Änderungen an lokalen Modell-Dateien, Keychain-Daten, Cloud-Deployments oder Mesh-Vertrauensbeziehungen.

## Tatsächlich ausgeführte Abnahme

- M2: Read-only-Vorabtest bestanden. Der Eigentümerdialog wurde nicht bestätigt beziehungsweise ist abgelaufen. Ergebnis STAGE4J_HANDOFF_OWNER_CANCELLED, Exit 5. Die bisherige App blieb aktiv; die neue wurde nicht gestartet.
- M3: identisches Skript, Syntaxprüfung und Read-only-Vorabtest bestanden. Es wurde kein Eigentümerdialog ausgelöst, kein Versionswechsel durchgeführt.
- 14 von 14 gezielten Node-Vertragstests für Instanzkontrolle, Modellschutz und sicheren Handoff bestanden.

## Gesamttest nach Einführung des Übergabehelfers

- 14/14 gezielte Handoff-, Single-Instance- und Modellschutz-Tests bestanden.
- Beide Negativtests (unbekanntes Gerät / unerlaubter Handoff-Modus) wurden wie vorgesehen mit Exit-Code 2 abgewiesen.
- Erster stark parallelisierter Gesamt-Testlauf: 870/871 PASS; ein bestehender Mesh-Inbox-CLI-Test lief unter Last in seine unveränderte Unterprozess-Grenze von 2 Sekunden (Prozessstatus null statt des erwarteten Sicherheits-Exitcodes 2).
- Dieser Mesh-Inbox-Test bestand anschließend isoliert mit 8/8 PASS; die CLI-Prüfung selbst benötigte rund 0,85 Sekunden.
- Vollständige Regression mit begrenzter Test-Parallelität (test-concurrency=4), **ohne Änderung an Testinhalt oder Timeout**: **871/871 PASS, 0 Fehler**.
- Kein Produktions-Merge, kein Push, kein automatischer Geräte-Trust, kein Start zusätzlicher Modellserver.

## Nächste Abnahme

Sobald alle lokalen Eingaben gespeichert sind und der Besitzer am jeweiligen Mac bestätigen kann: zuerst M2, dann M3 einzeln mit --owner-confirmed-handoff umstellen. Danach den jeweils einzigen neuen Prozess, das Beenden der alten PID, getrennte App-Konfiguration, keine spontane Modell-Inferenz und keine neue Mesh-Paarung nachweisen.

**Entscheidung:** STAGE4J_OWNER_HANDOFF_PREFLIGHT_TWO_MAC_PASS. MODEL_GUARD_LIVE_ACTIVATION_PENDING_OWNER_APPROVAL.

Created by NMKato Solutions
