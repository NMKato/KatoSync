# KatoSync Erklärvideo Briefing für NotebookLM

Stand: 24. Juni 2026  
Produkt: KatoSync v1.0.1  
Ziel: Grundlage für ein Erklärvideo, eine PDF oder eine Präsentation für Teamkollegen

## Kurzbeschreibung

KatoSync ist eine macOS-Desktop-App, mit der Teammitglieder lokale Projektstände automatisch in eine Mistral Library synchronisieren können. Die App ersetzt ein manuelles Shell-Skript durch eine einfache Oberfläche: API-Key eintragen, Library auswählen, Projektordner verbinden, Uploadplan aktivieren und KatoSync im Hintergrund arbeiten lassen.

Der wichtigste Nutzen: Projektstatus, Memory-Dateien, Roadmaps und Aufgabenstände landen regelmäßig als stabile CURRENT-Dateien in Mistral. Dadurch können Mistral Work, Skills und Agenten auf aktuelle Projektdaten zugreifen und daraus Briefings, Risiko-Checks oder Strategie-Updates erstellen.

## Zielgruppe des Videos

Dieses Video richtet sich an Teamkollegen, die KatoSync installieren und nutzen sollen, ohne selbst Skripte, Terminal-Automationen oder API-Uploads bauen zu müssen.

Die Zuschauer sollen nach dem Video verstehen:

- wofür KatoSync gedacht ist
- welche Daten synchronisiert werden
- wie der eigene Mistral API-Key sicher gespeichert wird
- wie ein Projektordner ausgewählt wird
- wie der automatische Uploadplan funktioniert
- warum Secret-Dateien geschützt werden
- was im Hintergrund passiert
- wie man prüfen kann, ob alles funktioniert

## Kernbotschaft

KatoSync verbindet lokale Projektarbeit mit Mistral. Die App sammelt relevante Projektstände, bündelt sie in CURRENT-Dateien und lädt sie kontrolliert in eine Mistral Library hoch. So können Mistral-Agenten mit aktuellen Informationen arbeiten, ohne dass der Nutzer jeden Tag manuell Dateien suchen, kopieren oder hochladen muss.

## Elevator Pitch

KatoSync ist der sichere Projektstatus-Uploader für Mistral Libraries. Einmal eingerichtet, scannt die App ausgewählte Projektordner, filtert sensible Dateien, erzeugt klare CURRENT-Dateien und lädt sie automatisch nach Mistral hoch. Das Team arbeitet weiter wie gewohnt, während Mistral immer aktuelle Projektstände für Briefings und Agenten-Auswertungen bekommt.

## Was KatoSync löst

Vor KatoSync wurden Projektstände über ein lokales Shell-Skript gesammelt und per API nach Mistral hochgeladen. Das funktioniert für Entwickler, ist aber für Teamkollegen schwer zu installieren, schwer zu warten und nicht besonders nutzerfreundlich.

KatoSync macht daraus eine Desktop-App:

- keine Terminal-Befehle für normale Nutzer
- klare Oberfläche statt Skript-Konfiguration
- API-Key-Eingabe über ein Formular
- sichere Speicherung im macOS Schlüsselbund
- Ordnerauswahl per Finder
- sichtbarer Scan-Test
- automatischer Uploadplan
- Logs und Aktivitäten zur Kontrolle
- Lizenz- und Nutzungsvereinbarung beim ersten Start

## App-Aufbau

KatoSync besteht aus einer zentralen Dashboard-Ansicht. Die Navigation links springt direkt zu den wichtigsten Bereichen:

- Dashboard
- API
- Library
- Ordner
- Regeln
- Uploadplan
- Aktivitäten

Die App ist bewusst als Dashboard aufgebaut, damit Nutzer nicht durch viele leere Unterseiten klicken müssen. Alle wichtigen Einstellungen liegen an einem Ort, sind aber durch Navigation, Cards und Onboarding klar strukturiert.

## Erste Nutzung

Beim ersten Start erscheint zuerst die Lizenz- und Nutzungsvereinbarung. Der Nutzer muss bestätigen, dass er versteht, dass KatoSync ausgewählte lokale Projektinhalte über den eigenen Mistral API-Key in die eigene Mistral Library synchronisiert.

Danach startet das Onboarding. Es führt Schritt für Schritt durch die Einrichtung:

1. Mistral API-Key eintragen
2. Library ID eintragen
3. Verbindung testen
4. Library testen
5. Projektordner auswählen
6. Scan testen
7. Uploadplan aktivieren
8. ersten Sync ausführen

Das Onboarding hebt den jeweils relevanten Bereich hervor und blendet den Rest optisch zurück. So weiß der Nutzer genau, was als Nächstes zu tun ist.

## Wichtige Begriffe

### API-Key

Der API-Key ist der persönliche Zugriffsschlüssel für Mistral. KatoSync nutzt diesen Schlüssel, um Dateien in die Mistral Library des Nutzers hochzuladen. Der Key wird nicht in Klartext in einer Konfigurationsdatei gespeichert, sondern im macOS Schlüsselbund.

### Library ID

Die Library ID ist die eindeutige ID der Mistral Library, in die KatoSync Dateien hochladen soll. Diese Library wird später von Mistral Work, Skills oder Agenten als Wissensquelle genutzt.

### Projektordner

Ein Projektordner ist ein lokaler Ordner auf dem Mac. KatoSync scannt diesen Ordner inklusive Unterordnern. Dadurch kann ein Nutzer auch einen großen Hauptordner auswählen, in dem mehrere Projekte liegen.

### CURRENT-Dateien

CURRENT-Dateien sind stabile Zusammenfassungsdateien, die KatoSync erzeugt. Sie bündeln die relevanten Projektinformationen, damit Mistral nicht mit vielen verstreuten Einzeldateien arbeiten muss.

Beispiele:

- `CURRENT_PROJECT_STATUS_ALL.md`
- `CURRENT_MEMORY_ALL.md`
- `CURRENT_MISTRAL_BRIEFING_SOURCE.md`
- `CURRENT_SNAPSHOT_INDEX.md`
- `CURRENT_MANIFEST.md`

### Secret-Scanner

Der Secret-Scanner erkennt mögliche sensible Inhalte wie API-Keys, Tokens oder private Konfigurationsdateien. Solche Dateien werden markiert oder ausgeschlossen, damit nicht versehentlich vertrauliche Informationen an Mistral gesendet werden.

### Uploadplan

Der Uploadplan ist ein lokaler macOS LaunchAgent. Er startet KatoSync zu einer gewählten Uhrzeit automatisch im Hintergrund. Der Mac muss dafür eingeschaltet und angemeldet sein. Wenn der geplante Zeitpunkt verpasst wurde, führt macOS geplante Jobs normalerweise zum nächstmöglichen passenden Zeitpunkt aus.

## Welche Dateien werden berücksichtigt?

KatoSync sucht gezielt nach Dateien, die Projektfortschritt, Kontext oder Arbeitsstand beschreiben. Der Fokus liegt auf textbasierten Projektdateien.

Typische relevante Dateien:

- Projektstatus-Dateien
- Statusflow-Dateien
- Memory-Dateien
- Roadmaps
- Tasks und Todos
- Refactoring-Notizen
- Entscheidungsprotokolle
- Projektzusammenfassungen
- Markdown- und Textdateien mit Projektkontext

Typische Dateinamen oder Muster:

- `ProjektStatusFlow.md`
- `PROJECT_STATUS.md`
- `PROJECT_STATUS_FLOW.md`
- `MEMORY.md`
- `roadmap.md`
- `tasks.md`
- `todo.md`
- `REFactoring_SUMMARY.md`

Die App kann Unterordner durchsuchen. Das ist wichtig, wenn ein Hauptordner mehrere Projekte enthält.

## Was wird nicht hochgeladen?

KatoSync soll keine sensiblen Entwicklungs- oder Systemdaten unkontrolliert hochladen.

Typische Ausschlüsse:

- `.env`
- API-Key-Dateien
- Tokens
- private Konfigurationen
- Build-Ordner
- Cache-Ordner
- `.git`
- `node_modules`
- große Binärdateien
- Dateien mit Secret-Mustern

Wenn eine verdächtige Datei gefunden wird, zeigt KatoSync das im Scan-Ergebnis an.

## Sicherheitsprinzipien

KatoSync ist so gebaut, dass normale Teamkollegen sicher arbeiten können.

Wichtige Sicherheitsentscheidungen:

- API-Key wird im macOS Schlüsselbund gespeichert.
- API-Key wird nicht in Logs geschrieben.
- KatoSync löscht keine Dateien aus der Mistral Library.
- Secret-Muster werden erkannt.
- Dry-Run beziehungsweise Testlauf ohne Upload ist möglich.
- Der Nutzer sieht, welche Dateien gefunden wurden.
- Uploads laufen kontrolliert über die Mistral API.
- Jeder Rechner bekommt eine eigene Gerätekennung.

## Mehrere Rechner und eine Library

KatoSync kann auf mehreren Geräten installiert werden. Wenn mehrere Rechner dieselbe Mistral Library nutzen, ergänzt KatoSync gerätespezifische Kennungen in den Upload-Dateinamen. Dadurch ist erkennbar, von welchem Rechner die Daten stammen.

Beispiel:

- `CURRENT_PROJECT_STATUS_ALL__macbook-air-von-nikolas_9ec88740.md`
- `CURRENT_MEMORY_ALL__arbeitslaptop_2ab319f0.md`

So können mehrere Geräte in eine gemeinsame Library synchronisieren, ohne dass Dateien unklar überschrieben oder vermischt werden.

## Race Conditions und gleichzeitige Uploads

Wenn zwei Rechner zur gleichen Zeit hochladen, entstehen mehrere API-Requests an Mistral. KatoSync reduziert Konflikte durch eindeutige Dateinamen pro Gerät. Dadurch müssen zwei Geräte nicht dieselben Dateinamen aktualisieren.

Für Version 1.0 bedeutet das:

- Jeder Rechner erzeugt eigene CURRENT-Dateien mit Gerätekennung.
- Gleichzeitige Uploads sind dadurch deutlich sauberer trennbar.
- Mistral erhält mehrere Quellen und kann sie anhand der Dateinamen unterscheiden.

Für spätere Versionen kann zusätzlich eine Queue-Logik oder ein koordinierter Upload-Lock ergänzt werden, falls Mistral-seitig strengere Reihenfolgen nötig werden.

## Automatischer Betrieb

Nach der Einrichtung muss der Nutzer nicht jeden Tag manuell synchronisieren.

Normaler Ablauf:

1. KatoSync wird einmal eingerichtet.
2. API-Key und Library ID werden gespeichert.
3. Projektordner werden ausgewählt.
4. Uploadplan wird aktiviert.
5. Die App läuft im Hintergrund weiter.
6. Zur geplanten Zeit werden die Daten gescannt und hochgeladen.

Der Button „Jetzt zusätzlich synchronisieren“ ist nur für einen manuellen Sofortlauf gedacht. Er ersetzt nicht den automatischen Uploadplan.

## Hintergrundbetrieb auf macOS

Wenn der Nutzer das Fenster über das X schließt, wird die App ausgeblendet und kann im Hintergrund weiterarbeiten. Das ist wichtig für automatische Uploads.

Wenn der Nutzer den roten Button „Programm beenden“ nutzt, wird KatoSync vollständig geschlossen. Dann werden keine automatischen Uploads mehr ausgeführt, bis die App wieder gestartet wird.

Darum erklärt die App beim Beenden, dass der Hintergrundbetrieb endet.

## Mistral Workflow

KatoSync übernimmt Version 1.0 vor allem den Daten-Upload in die Library. Die eigentlichen Briefings und Agenten-Auswertungen laufen danach in Mistral Work.

Typisches Setup:

1. KatoSync lädt CURRENT-Dateien in eine Mistral Library.
2. Mistral Work Scheduler startet geplante Aufgaben.
3. Skills wie Laura, David, Thomas oder Mai greifen auf die Library zu.
4. Die Agents erstellen Briefings, Risiko-Checks oder Strategie-Reports.

Wichtig: Der lokale Uploadplan in KatoSync ist nicht dasselbe wie der Mistral Work Scheduler. KatoSync sorgt dafür, dass die Library aktuell ist. Mistral Work entscheidet, wann daraus Reports erstellt werden.

## Aktueller Rückkanal

In Version 1.0 gibt es noch keinen vollständigen Rückkanal für fertige Mistral-Berichte in die App.

Geplant für Version 1.1:

- Workflow Runs per API abrufen
- fertige Reports lokal speichern
- Briefings in einem eigenen App-Bereich anzeigen
- gelesene und ungelesene Reports markieren
- Suche und Archiv für Berichte

Falls Mistral Reports nicht direkt per API verfügbar sind, kann später ein Gmail- oder Outlook-Import als Alternative geprüft werden.

## UI und Nutzerführung

KatoSync nutzt eine moderne Dashboard-Oberfläche mit KatoOS-Branding.

Wichtige UI-Merkmale:

- KatoOS-K-App-Icon
- Dark Mode und Light Mode
- glasartige Header-Leiste mit Blur-Effekt
- zentrale Cards für die wichtigsten Funktionen
- klare Buttons mit Klick-Feedback
- animierte Arbeitszustände beim Scan
- Onboarding-Overlay beim ersten Start
- Setup-Fortschritt in Prozent
- Hinweise und Sicherheitswarnungen
- Aktivitäten und Logs

Das Ziel ist eine App, die sich für normale Nutzer einfach anfühlt, aber technisch genug Kontrolle für Teamarbeit bietet.

## Architektur

KatoSync folgt der MVVM+R-Strategie.

### Model

Gemeinsame Datentypen für Konfiguration, Scan-Ergebnisse, Upload-Status, Regeln, Gerätekennung und Uploadplan.

### View

React-Komponenten für die Oberfläche. Die View enthält keine direkte API-, Datei- oder Keychain-Logik.

### ViewModel

Das ViewModel verwaltet UI-State, Nutzeraktionen, Validierung und Statusmeldungen.

### Repository

Das Repository kapselt den Zugriff auf Tauri Commands und trennt Frontend-Logik von Systemfunktionen.

### Rust/Tauri Core

Der Rust-Core übernimmt die systemnahen Aufgaben:

- Ordner scannen
- Secret-Muster erkennen
- CURRENT-Dateien erzeugen
- Mistral Upload ausführen
- API-Key im Schlüsselbund speichern
- LaunchAgent installieren
- Logs schreiben
- Fenster im Hintergrund ausblenden

Diese Trennung macht die App wartbar und erweiterbar.

## Installation

Für Teamkollegen wird KatoSync als macOS DMG bereitgestellt.

Installationsablauf:

1. DMG herunterladen
2. DMG öffnen
3. `KatoSync.app` in den Programme-Ordner ziehen
4. App aus dem Programme-Ordner starten
5. Lizenz akzeptieren
6. Onboarding abschließen

Aktueller GitHub-Download:

`https://github.com/NMKato/KatoSync/releases/download/v1.0.1/KatoSync_1.0.1_aarch64.dmg`

Hinweis: Die App ist Developer-ID-signiert. Für die vollständig glatte Gatekeeper-Freigabe ist zusätzlich Apple-Notarisierung vorgesehen.

## Lizenz- und Nutzungsvereinbarung

Beim ersten Start muss der Nutzer die Lizenz- und Nutzungsvereinbarung akzeptieren. Dort wird erklärt:

- wofür KatoSync gedacht ist
- dass der Nutzer selbst verantwortlich ist, welche Daten er auswählt
- dass Mistral API-Key und Mistral Konto beim Nutzer liegen
- dass sensible Daten nicht absichtlich hochgeladen werden sollen
- dass automatische Uploads nur laufen, wenn die App beziehungsweise der Hintergrundbetrieb aktiv ist
- dass KatoSync keine Hochrisiko-Entscheidungen ersetzt

Die Nutzungsvereinbarung kann später in der App erneut geöffnet werden.

## Video-Struktur

### Szene 1: Einstieg

Bildidee:

- KatoSync App-Icon
- kurzer Blick auf das Dashboard
- Mistral Library im Hintergrund

Sprechertext:

„KatoSync verbindet lokale Projektarbeit mit Mistral. Statt Projektstände manuell zu sammeln oder ein Shell-Skript zu pflegen, übernimmt die App den sicheren Upload relevanter Projektdateien in eine Mistral Library.“

### Szene 2: Das Problem

Bildidee:

- Terminal-Skript oder alte manuelle Arbeitsweise
- viele Projektordner
- Mistral Library als Ziel

Sprechertext:

„In vielen Teams liegen wichtige Projektstände lokal in Markdown-Dateien, Statusprotokollen, Roadmaps und Memory-Dateien. Für Mistral-Agenten sind diese Informationen nur dann nützlich, wenn sie regelmäßig und sauber in einer Library landen.“

### Szene 3: Die Lösung

Bildidee:

- KatoSync Dashboard mit API, Ordnern, Regeln und Uploadplan

Sprechertext:

„KatoSync macht daraus einen einfachen Desktop-Prozess. Der Nutzer trägt seinen Mistral API-Key ein, wählt die Library, verbindet Projektordner und aktiviert einen Uploadplan. Danach arbeitet KatoSync automatisch im Hintergrund.“

### Szene 4: Sicherer Start

Bildidee:

- Lizenzdialog
- Onboarding-Overlay

Sprechertext:

„Beim ersten Start erklärt KatoSync die Nutzungsbedingungen und führt Schritt für Schritt durch die Einrichtung. So versteht jeder Nutzer, welche Daten hochgeladen werden und welche Verantwortung beim eigenen Mistral-Konto liegt.“

### Szene 5: Mistral Zugang

Bildidee:

- API-Key-Feld
- Library ID
- Verbindung testen
- Library testen

Sprechertext:

„Der API-Key wird im macOS Schlüsselbund gespeichert. Die App testet anschließend die Verbindung und prüft, ob die angegebene Mistral Library erreichbar ist.“

### Szene 6: Projektordner

Bildidee:

- Ordnerauswahl
- mehrere lokale Projektordner
- Scan-Test mit Animation

Sprechertext:

„Der Nutzer wählt einen oder mehrere Projektordner aus. KatoSync scannt auch Unterordner, damit Hauptordner mit mehreren Projekten sinnvoll genutzt werden können.“

### Szene 7: Relevante Dateien

Bildidee:

- Gefundene Dateien
- Status, Memory, Roadmap
- Secret-Muster erkannt

Sprechertext:

„KatoSync konzentriert sich auf Dateien, die Projektstände erklären: Statusflows, Memory-Dateien, Roadmaps und Aufgabenlisten. Gleichzeitig schützt der Secret-Scanner vor versehentlichen Uploads sensibler Daten.“

### Szene 8: CURRENT-Dateien

Bildidee:

- Output-Ordner mit CURRENT-Dateien
- Mistral Library mit hochgeladenen Dateien

Sprechertext:

„Aus den gefundenen Projektinformationen erzeugt KatoSync stabile CURRENT-Dateien. Diese Dateien sind optimiert dafür, dass Mistral Work und Skills schnell den aktuellen Projektkontext erfassen können.“

### Szene 9: Automatischer Uploadplan

Bildidee:

- Uploadplan Card
- Wochentage
- Uhrzeit
- LaunchAgent installiert

Sprechertext:

„Mit dem lokalen Uploadplan läuft KatoSync automatisch zu einer festgelegten Zeit. Der Nutzer muss den Sync nicht jeden Tag manuell starten. Wichtig ist nur, dass der Mac eingeschaltet und angemeldet ist.“

### Szene 10: Mistral Agenten

Bildidee:

- Mistral Work Scheduler
- Skills Laura, David, Thomas, Mai
- Library als Datenquelle

Sprechertext:

„Sobald die Library aktuell ist, können Mistral Skills und geplante Work-Aufgaben damit arbeiten. So entstehen Briefings, Risiko-Checks oder Strategie-Updates auf Basis der neuesten Projektstände.“

### Szene 11: Aktivitäten und Kontrolle

Bildidee:

- Aktivitäten Card
- Logs
- Hinweise

Sprechertext:

„KatoSync zeigt Aktivitäten, Hinweise und Logs an. Wenn ein Upload funktioniert, ein Ordner keine neuen Daten enthält oder ein Secret-Muster erkannt wurde, bekommt der Nutzer klares Feedback.“

### Szene 12: Abschluss

Bildidee:

- Dashboard mit 100 Prozent Setup
- Mistral Library mit aktuellen Dateien

Sprechertext:

„KatoSync ist der einfache Weg, lokale Projektstände zuverlässig in Mistral nutzbar zu machen. Einmal eingerichtet, bleibt die Library aktuell und Agenten können mit sauberem Kontext arbeiten.“

## Beispielhafter Sprechertext als durchgehendes Script

KatoSync ist eine Desktop-App für macOS, die lokale Projektstände automatisch in eine Mistral Library synchronisiert.

Die Idee dahinter ist einfach: Viele wichtige Informationen liegen nicht zentral in einem Tool, sondern verteilt in Projektordnern. Dort befinden sich Statusprotokolle, Memory-Dateien, Roadmaps, Aufgabenlisten und technische Notizen. Genau diese Dateien sind für Mistral-Agenten wertvoll, weil sie zeigen, woran gerade gearbeitet wird, welche Entscheidungen getroffen wurden und welche nächsten Schritte offen sind.

Früher konnte so ein Upload über ein Shell-Skript laufen. Das ist für Entwickler machbar, aber für Teamkollegen zu technisch. KatoSync macht daraus eine App mit klarer Oberfläche.

Beim ersten Start akzeptiert der Nutzer die Nutzungsvereinbarung und wird dann durch das Onboarding geführt. Zuerst wird der Mistral API-Key eingetragen. Dieser Key wird sicher im macOS Schlüsselbund gespeichert. Danach wird die Library ID angegeben und getestet.

Anschließend wählt der Nutzer einen oder mehrere Projektordner aus. KatoSync scannt diese Ordner inklusive Unterordnern. Dabei sucht die App nach relevanten Projektdateien und erkennt gleichzeitig mögliche sensible Dateien. Der Secret-Scanner hilft dabei, API-Keys, Tokens oder private Konfigurationen nicht versehentlich hochzuladen.

Nach dem Scan erzeugt KatoSync stabile CURRENT-Dateien. Diese Dateien bündeln Projektstatus, Memory-Inhalte, Roadmaps und Snapshot-Informationen. Sie sind dafür gedacht, dass Mistral Work und Mistral Skills schnell auf aktuellen Kontext zugreifen können.

Der automatische Uploadplan sorgt dafür, dass dieser Prozess regelmäßig im Hintergrund läuft. Der Nutzer legt Uhrzeit und Wochentage fest. Danach muss er nicht jeden Tag manuell synchronisieren. Wenn er sofort einen zusätzlichen Lauf starten möchte, kann er das weiterhin über die App tun.

In Mistral können anschließend geplante Work-Aufgaben und Skills auf die Library zugreifen. So können Agenten wie Laura, David, Thomas oder Mai aus den aktuellen Daten Briefings, Risikoanalysen oder strategische Updates erstellen.

KatoSync ist damit die Brücke zwischen lokaler Projektarbeit und Mistral-Agenten. Die App sammelt relevante Projektstände, schützt sensible Daten, synchronisiert kontrolliert in die Library und macht den täglichen Kontext für KI-Workflows nutzbar.

## Screenshot-Liste für die PDF

Diese Screenshots eignen sich besonders für NotebookLM, PDF oder Präsentation:

- App-Icon und Startbildschirm
- Lizenz- und Nutzungsvereinbarung
- Onboarding Schritt „API-Key eintragen“
- Mistral Zugang mit API-Key und Library ID
- Verbindung testen und grüne Erfolgsmeldung
- Projektordner auswählen
- Scan-Test mit Arbeitsanimation
- Gefundene Dateien mit Kategorien und Secret-Hinweisen
- Output-Ordner mit CURRENT-Dateien
- Mistral Library nach erfolgreichem Upload
- Uploadplan mit Wochentagen und Uhrzeit
- Aktivitäten und Logs
- Dark Mode und Light Mode

## Folienvorschlag

### Folie 1: Titel

KatoSync  
Project Memory Uploader für Mistral Libraries

### Folie 2: Problem

Projektstände liegen lokal und verteilt. Mistral-Agenten brauchen aber aktuellen, sauberen Kontext.

### Folie 3: Lösung

KatoSync scannt Projektordner, erzeugt CURRENT-Dateien und lädt sie in eine Mistral Library hoch.

### Folie 4: Einrichtung

API-Key, Library ID, Projektordner, Uploadplan.

### Folie 5: Sicherheit

Keychain, Secret-Scanner, keine API-Key-Logs, keine Mistral-Löschlogik.

### Folie 6: Automatisierung

LaunchAgent startet Uploads zu geplanten Zeiten im Hintergrund.

### Folie 7: Ergebnis

Mistral Skills und Agenten arbeiten mit aktuellen Projektständen.

### Folie 8: Ausblick

Reports Inbox, Workflow Runs, fertige Briefings direkt in KatoSync.

## Wichtige Hinweise für Zuschauer

- KatoSync ersetzt nicht Mistral Work, sondern versorgt Mistral mit aktuellen Daten.
- Der lokale Uploadplan steuert nur den Upload in die Library.
- Die eigentlichen Agenten-Berichte entstehen in Mistral Work.
- Der Nutzer entscheidet, welche Ordner verbunden werden.
- Sensible Dateien sollten nicht absichtlich in Projektstatus-Dateien kopiert werden.
- Der Secret-Scanner ist ein Schutzmechanismus, aber keine vollständige Sicherheitsgarantie.
- Automatische Uploads laufen nur, wenn KatoSync beziehungsweise der Hintergrundprozess aktiv ist.
- Bei mehreren Geräten helfen Gerätekennungen, Uploads auseinanderzuhalten.

## Kurzer Abschluss für das Video

„Mit KatoSync wird der tägliche Projektkontext automatisch für Mistral nutzbar. Das Team arbeitet weiter in seinen gewohnten Ordnern, während KatoSync relevante Projektstände sicher bündelt und synchronisiert. So bekommen Mistral-Agenten die Informationen, die sie für gute Briefings und bessere Entscheidungen brauchen.“

