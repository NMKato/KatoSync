# Stage 4AB.3 – Sicherer Reconnect-Nachweis, Stufe 1

**Repository:** NMKato/KatoSync | Tracking #269 | Basis-Draft-PR #272.
**Zweig:** qa/stage4ab3-controlled-reauth-reconnect-20261116.
**Stand:** QA-only, kein Produktiv-Dauer-Mesh.

## Geprüfte Basis

AB.2 beweist zwei unabhängige Richtungen einer über zwei Standorte
ausgehandelten, gegenseitig gepinnten TLS-1.3-Sitzung mit je drei
gültigen, neu authentifizierten In-Channel-Heartbeats. Kein Job-Grant,
keine laufende Session nach Abschluss.

## AB.3.1 als kontrollierter Zwischenschritt

Ein zusätzlicher, nur im bestehenden QA-Feature kompilierter,
ausdrücklich manuell gestarteter CLI-Einstieg führt **zwei hintereinander
aufgebaute, jeweils vollständig authentifizierte TLS-Sitzungen** aus.
Das ist ein sicherer Hardware-Nachweis der Reauthentifizierung nach
ordnungsgemäßem Socket-Close und *noch kein* automatischer Reconnect
nach tatsächlicher Netzstörung.

Neue vierte Zustimmung:
KATOSYNC_STAGE4AB3_RECONNECT_QA_TWICE=OWNER_LAUNCHED_REAUTH_TWICE_QA_ONLY

Die drei vorhandenen Owner-QA-Opt-ins aus Stage4W/AA/AB2 bleiben
zusätzlich erforderlich. Ein SingleQaPermit bleibt über beide
Sitzungen hinweg in derselben QA-App gehalten. Der AB2-Supervisor
muss für **jede** Sitzung eine neue Online-Owner-/Keychain-/Enrollment-
Zulassung, neue TLS-1.3-Handshakes, neue unabhängige Nonces und drei
gültige Heartbeats nachweisen. Ein Fehler beendet den gesamten Test
ohne Fallback. Maximal 235 Sekunden und keine Dauerprozesse.
Das positive Receipt wird erst nach beiden geschlossenen Sitzungen
erzeugt. Keine fremden Gerätebefehle, kein IPC, keine Schlüsseländerung.

## Zustands- und Fehlerverhalten

AB.1-Leases werden jetzt auch bei asynchronem Early-Return über
Rust Drop explizit geschlossen. Ein internes QA-Fault-Modell stellt
sicher: Revoke/Ownerwechsel, Sleep/Wake und Netzwerkverlust
invalidieren die Authentifizierung sofort. Die spätere
Reconnect-Backoff-Policy (2/4/8 Sekunden) ist **nur testbare pure
Policy**, noch nicht als automatischer Supervisor gestartet. Ein
abgelehnter/anderer Owner darf keinen Connect-Retry auslösen.

## Abnahme-Gates

1. Native Rust-Unit-Tests, Node-Contract-Tests, Rustfmt, CI und
   ausführbarer ARM64-Test-Build; keine CI-Signierschlüssel.
2. Neuer isolierter, Apple-signierter und notarisierter QA-Build,
   identischer SHA256 auf M2/M3, bestehende AB2-Builds erhalten.
3. Positiver Hardware-Test von zwei **separaten** Sitzungen in
   beiden Richtungen sowie Negativtests ohne vierte QA-Zustimmung.
   Prüfen: Nach jeder Phase keine produktive Geräteautorität,
   nach Abschluss keine Listener oder verbundenen Sockets.
4. Nachgelagert: **AB.3.2** echter Abbruch eines gerade laufenden
   Kanals und Backoff-Reconnect, Netzwerkwechsel und
   kontrollierte Sleep/Wake-Prüfung; ohne Router-/Wi-Fi-/Keychain-
   Manipulation auf Remote-Testgeräten.
5. Security Review vor jeder dauerhaften Netzverbindung,
   Main-Merge, Produktivumsetzung und RC65-MCP-Rechten.

**Keine Freigabe:** AB.3.1 beweist weder Live-Revocation gegen einen
wirklich widerrufenen Key noch OS-Sleep-Wake oder störungsbedingtes
automatisches Reconnect. Diese Tests sind separat offengehalten.
