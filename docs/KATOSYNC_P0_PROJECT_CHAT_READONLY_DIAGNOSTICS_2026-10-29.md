# KatoSync 2.0 – P0: Projekt-Chat und Read-only-Dispatcher

Status: 29.10.2026, isolierter Draft-Branch, keine Stable-Release-Freigabe.

## Live-Grundlagen (nichtdestruktiv geprüft)

Auf dem signierten M2 Mesh-QA-Profil besteht die lokale Memory-Fabric-
SQLite-Datenbank, sie ist schema-v4, quick_check=ok, und das eine
indexierte Projekt hat einen passenden registrierten Git-Root-Fingerprint.
Ein Verlauf mit fünf Einträgen und die erwartete lokale Chat-Tabelle
sind vorhanden. Damit ist die **ursprüngliche V1-/Root-Mismatch-
Beschreibung von Issue #130 auf dem heutigen M2 nicht mehr belegbar**.
Das ist ein read-only Datenbank- und Identitätsnachweis, noch **kein
bestätigter Mensch/Modell-Chatlauf**. Vorerst keinerlei automatische
Neuindexierung oder Umhängung fremder Projektidentitäten vornehmen.

Auf dem M3 existiert im isolierten QA-Profil noch kein eigenes
lokales Memory-Fabric-Projektregister und keine SQLite-Datei. Dies
ist ein **Erstindexierungsfall**, nicht der gleiche Reparaturfall
wie bei einem beschädigten M2-Bestand. Ein eigener Operator-
gesteuerter Projektimport mit Backup- und Root-Gate bleibt nötig;
keine Übertragung von lokalen M2-Chatdaten/Keys.

## Read-only-Diagnose Issue #125 verbessert

- Native CLI-Suche berücksichtigt das macOS Finder/Tauri-PATH-Problem:
  HOME/.local/bin, Homebrew, /usr/local/bin, PATH und Windows-exe
  als Lookup, statt blind `codex` oder `claude` aufzurufen.
- Der eigentliche Preflight prüft **nach** Online-User-/Registry-
  und Git-Root-Validierung, **ohne** den Agenten zu starten, ob
  das ausgewählte CLI verfügbar ist. Fehlercode RO_PROVIDER.
- Auch ein fehlgeschlagener Scratch-Ordner, CLI-Start, Exit,
  ungültiger Git-Nachweis oder Timeout erhält nach geprüftem
  Auth/Projekt einen **persistierbaren, kontogebundenen Jobbeleg**
  mit UUID und kategorialem `failureCode`. Vorher/Nachher-Git-
  Nachweis bleibt erforderlich; Änderung führt zum Fehlerzustand.
- UI zeigt aussagefähige, übersetzte, ungefährliche Fehlerkategorien
  statt roher Stderr-/CLI-Ausgaben. Ältere lokale Jobberichte
  ohne `failureCode` bleiben lesbar.
- Auftrag bleibt **strikt ein einzelner, ausdrücklich ausgelöster,
  temporär isolierter Read-only-Metadaten-Test**; kein CLI-Zugriff
  auf Quellcode, kein Git-Checkout, kein automatischer Runner,
  keine schreibende Lane oder zusätzliche Netzwerkfreigabe.

## Gates – noch nicht als freigegeben melden

- Signed M2-App mit dieser **neuen** Codeversion erneut bauen;
  CLI-Auflösung/Read-only-Preflight aus der echten App verifizieren.
- Dann exakt **je einen** Codex- und Claude-Probeauftrag bewusst
  auslösen und die Job-ID, before/after HEAD+Branch+Porcelain,
  Exit-Code, CLI-Fehlercode und lokal gebundene Historie prüfen.
- Chat-UI unter tatsächlicher Auswahl des indexierten Projekts
  testen; danach mit bewusstem Operator-Start lokale Q&A ohne
  Cloud-Fallback testen. Antwort nur auf belegte lokale Quellen
  (sonst NOT_IN_MEMORY).
- M3 Projektregistrierung durch Operator und eigene Datenbank
  erst danach kontrolliert aufbauen. Keine stillschweigende
  DB-Migration.
- Vor Veröffentlichung: komplette gestapelte Draft-PR-Kette
  kontrolliert nach main integrieren, Signatur/Update, Windows-
  E2E, Schreibrechte nach Issue #76 hart absichern.

In diesem Schritt wurden keine vorhandenen Projektdateien, Datenbanken,
M2/M3-Keychain-Identitäten, installiertes QA-Bundle, Git-Branches
in Nutzerrepositories oder Produktions-Mesh-Policies verändert.

## Live-UI-Abnahme: Read-only und lokaler Projektchat

Am 29.10. wurde die aktualisierte, Developer-ID-signierte isolierte
QA-App auf M2 und M3 installiert; SHA-256 und Signatur beider
ausführbaren Dateien waren vor UI-Tests identisch.

Auf M2 über `Agent Sync → Jobs & Queue → Sicherer Testauftrag`:
- KatoSync als registriertes lokales Projekt ausgewählt;
- Codex-Preflight **grün**, danach ein echter expliziter Job:
  Erfolg, Exit 0, 5,2 Sekunden, account-scoped JSON-Quittung,
  before/after Branch, HEAD und Git-Porcelain **unverändert**;
- Claude-Preflight **grün**, danach ein echter expliziter Job:
  Erfolg, Exit 0, 5,9 Sekunden, eigene account-scoped
  JSON-Quittung, before/after Git-Nachweis **unverändert**.
- CLI-Prompts enthielten **ausschließlich begrenzte Git-Metadaten**,
  keine Projektdateien. Kein schreibender Runner ausgeführt.
Damit ist der Reproduktionsfall aus Issue #125 auf dem M2
**positiv abgenommen**. Kein entsprechender E2E-Lauf auf Windows
oder M3 wurde behauptet.

Über `Agent Sync → Master-Chat` wurde auf M2 das registrierte
Projekt KatoSync gewählt. Das Fenster lädt die fünf vorhandenen
lokalen Einträge inklusive Markdown/Tabellen korrekt. Der
alte reine Historien-Ladefehler (#130) ist für dieses QA-
Projekt **nicht mehr reproduzierbar**.

Ein ausdrücklicher **einmaliger lokaler Offline-Gemma-Frageversuch**
lieferte hingegen eine **generische** UI-Meldung
('Antwort nicht gespeichert oder Chat-Verlauf inzwischen geändert').
Die SQLite-DB blieb `quick_check=ok`, Version 4, fünf Turns.
In der bisherigen React-Implementierung wurden **alle**
Backend-Fehler pauschal als Speicherproblem behandelt und die
History-Ansicht vorschnell gesperrt.

Die nachfolgende gezielte Korrektur:
- Modellfehler bekommen feste Backend-Codes
  `CHAT_MODEL_NOT_READY` und `CHAT_IMAGE_MODEL_NOT_READY`;
- ein reiner UI-Classifier trennt **Modell nicht bereit**,
  **Historie geändert**, **Projektidentität geändert** und
  **Speicher/anderer Fehler**; keine rohen Backenddaten/Tokens
  werden in die UI übernommen;
- bei fehlendem Gemma bleibt die geladenen Historie sichtbar
  und die nicht gesendete Frage erhalten; **keine automatische
  DB-Reparatur oder Cloud-Ausweichroute**;
- bei echten Race-/Git-/Storage-Konflikten bleiben
  Fail-Closed und erforderliches Neuladen aktiv;
- 4 neue Tests für Klassifizierung, Sicherheit und
  React/native Verknüpfung. Gesamt: **335 Node grün**,
  **220 Rust bestanden, 8 ignoriert**, QA-Web-Build grün.

Wichtig: Die präzise Ursache des ersten Modellfehlers
war durch die alte generische UI-Meldung **nicht rückwirkend
belegbar**. Ein realer Chat-Frage-/Antwortlauf mit dem
neuen Modellfehlerhinweis und anschließendem lokalen Modellstart
bleibt als eigener Schritt vor Offline-Freigabe offen.
