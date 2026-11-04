# KatoSync 4.0 — Smart Project Flow: Repository × Roadmap × Arbeit × Prognose

**Produktentscheidung:** 04.11.2026. Status: eigenständig getesteter QA-Implementierungsslice, noch kein notarisiert installiertes 4.0-Release.

## Ziel: die wirklich intelligente Projektanzeige

Aus der existierenden Projekt-Registry, den Projektstatus-/Handoff-Dokumenten, dem versionierten Git-Stand, einem explizit importierten gewichteten MVP-Scope, GitHub-CI-Evidence und dem kanonischen Agenten-Jobmodell eine nachvollziehbare Übersicht bilden. Die Anzeige zeigt **was erledigt gemeldet ist**, **was unabhängig bestätigt wurde**, **welche Lane gerade nachweislich an welchem Job arbeitet**, **welcher dokumentierte Projektabschnitt als Nächstes folgt** und **ob ein Prognosezeitraum wirklich gerechtfertigt ist**.

### Quellen und erlaubte Folgerungen

| Quelle | Aussage | Darf niemals bedeuten |
|---|---|---|
| Blueprint/MVP `mvpScope` und strukturierte Checkpoints | Gewichteter **gemeldeter** Arbeitsfortschritt | Feature akzeptiert oder bestanden |
| Projektstatus-/Handoff-Dateien im Registry-Scan und Context Capsule | Dokumentierter Arbeitsschwerpunkt und nächste Aufgaben | Aktuell laufender Prozess oder Vertrauensbeweis |
| Lokaler Git-HEAD/Arbeitsbaum plus Projektverifikationsstatus | Konsistenter Repository-/Dokument-Snapshot oder Konflikt | Fertigstellung |
| Authentifizierte GitHub-CI-Checks | GitHub hat den konkreten Job für einen konkreten HEAD ausgeführt | Produkt-/Feature-/E2E-Abnahme |
| `AgentSyncState.jobs` | Welcher Provider/Lane welchen Projektjob mit welchem Status trägt | Arbeitsaktivität ohne zeitnahe Heartbeat-/Jobmeldung |
| Historische **echte, unabhängig akzeptierte** Feature-Meilensteine | Verifizierter Geschwindigkeitsverlauf (ab mindestens 3 Abnahmen) | Garantie auf ein Releasedatum |

### Formel für Roadmap-Prozentwerte

Für nur explizit im MVP-Scope definierte Aufgaben mit Gewicht 1–5:

`reported_percent = floor(100 × sum(weight für claimed_done) / sum(weight aller MVP-Aufgaben))`.

Die `side`-Aufgaben bleiben in dieser MVP-Quote ausdrücklich ausgeschlossen. Bei fehlendem Scope, ungültiger Gewichtssumme oder widersprüchlicher Backend-Angabe wird **kein Prozentwert** angezeigt. Der gemeldete Wert wird sichtbar als **nicht unabhängig abgenommen** bezeichnet. Repo-Commits, Anzahl grüner CI-Tests oder Lines of Code fließen **nicht** in den Fertigstellungsprozentsatz ein.

Die einzige zulässige **abgenommene Prozentzahl** stammt aus unabhängigen featurebezogenen Tests und Owner-Freigaben zum gleichen unveränderten Blueprint/HEAD. Diese Schnittstelle liefert derzeit `verifiedPercent = null`; daraus darf KatoSync weder 0 %, 100 % noch einen fiktiven ETA-Wert ableiten.

### Repository-/Job-Wahrheit

- Repository ist nur **konsistent**, wenn Git-HEAD exakt mit dem verifizierten Dokument-/Projekt-HEAD übereinstimmt, der Arbeitsbaum unverändert ist und der Scan höchstens 48 Stunden alt ist. Sonst `dirty`, `conflict`, `stale` oder `unknown` — stets ohne Feature-Abnahme zu behaupten.
- Als **aktiver Job** gilt nur der im AgentSync-Modell als `running` geführte Auftrag mit genau passender Projekt-ID und einer letzten echten Aktivitätsmeldung innerhalb von 180 Sekunden. Ohne solche Meldung ist die Anzeige **nicht live bestätigt**, selbst wenn der Jobstatus weiterhin `running` heißt.
- Offene gemeldete Aufgaben, dokumentierte nächste Arbeitsaktionen und Warnungen/Human-Gates erscheinen getrennt von tatsächlicher Jobausführung. Bei Blockern kann die ETA bewusst ausgesetzt werden.

### ETA-Schätzung (nur bei empirischer Evidenz)

Die reine Funktion `forecastAcceptedRoadmap40` besitzt jetzt einen konservativen, testbaren Prognosealgorithmus:

1. Ausschließlich **verifizierte** Abnahmen mit unveränderter `projectId` und `planJournalSequence`, individuellem immutable Git-HEAD, verifizierter CI, dokumentierter Owner-Genehmigung und nachweisbarer Receipt-Herkunft können später als Verlaufssamples eingebunden werden. Die letzte Abnahme muss dem aktuellen abgenommenen Prozentwert entsprechen.
2. Mindestens **3 verschiedene Meilenstein-Abnahmen über mindestens 7 Tage**, mindestens zwei positive Geschwindigkeitsintervalle mit jeweils mindestens einem Tag; letzte Abnahme höchstens sieben Tage alt. Regressionen, doppelte HEADs, geänderte Roadmap oder Blocker verhindern die Prognose.
3. Gemessene Fortschrittsraten in Prozentpunkten/Tag geben mit konservativen Faktoren von **0,65× der langsamsten** bis **1,2× der schnellsten** aktuellen Rate eine Szenariospanne. Bei unplausiblen/über 365 Tage liegenden Schätzungen: **keine Prognose**. Annahme immer: vergleichbares Tempo, keine neuen kritischen Blocker, unveränderter Umfang.
4. Ergebnis: **frühester und späterer Kalendertag**, niedrige bis mittlere Aussagekraft und Erklärung der Datenbasis. **Kein einzelnes exaktes Datum, keine automatische Release-Freigabe und keine Behauptung, dass Modell-/Mesh-Sicherheit bereits bestanden ist.**

**Wichtig:** Die für die ETA nötige historische, unabhängig validierte Acceptance-Ledger-Schnittstelle ist **noch nicht an die Live-App angeschlossen**. Der derzeitige Backend-Status stellt keine akzeptierten Featureprozente bereit. Deshalb zeigt das reale neue Panel zunächst ehrlich „Prognose noch nicht belastbar“. Der **Algorithmus selbst** ist bereit und getestet; als nächstes muss der server-/git-gebundene, revisionssichere Abnahmeverlauf implementiert werden. Lokale Browserdaten oder nicht überprüfte Markdown-Aussagen dürfen diese Quelle nicht ersetzen.

## Erster UI-Slice und Nutzung

- Neues `ProjectProgressIntelligence40` direkt im Projektdossier von **Agent Sync → Projektportfolio**.
- Bereits im Portfolio wird für die wichtigsten Projekte angezeigt, ob ein Agent eine zeitlich aktuelle Aufgabe besitzt oder nur ein alter `running`-Status zurückgeblieben ist.
- Dossier enthält gemeldeten gewichteten Roadmap-Balken, getrennte unabhängige Feature-Abnahme, Repo-/Dokumentzustand, sichtbaren Arbeitsfokus, offene nächste Roadmap-Aufgaben, Jobbesitzer/Phase/Aktualität, Blocker, ETA-Status und aufklappbare Quellen.
- Die bestehende authentifizierte GitHub-CI-Ansicht bleibt separat, um `CI grün` **nicht** mit `Owner-Abnahme` zu verwechseln. Kein neuer Remote-Schreibzugriff, kein `git push` aus der Ansicht und keine Jobs werden durch den Balken gestartet.

## Harte nächste Gates

- Ein auditiertes, revisions-/Git-HEAD-gebundenes **Feature-Acceptance-Ledger** (Tests + Owner-Abnahme + Roadmap-Scope) mit datierten Snapshot-Receipts; erst danach reale Prognosen aktivieren.
- Empirische Prognose gegen mindestens zwei echte Projekte und Änderungen am Scope/Blocker testen; Einführung einer Kalibrierungsanzeige und Historienvergleich. Nach einer Roadmap-Neuplanung Forecast bewusst zurücksetzen.
- Schnellzugriff aus dem KAI-Widget auf das passende Projektstatus-Dossier, aber Widget erhält keine ungesicherten Roadmap-/Secret-Inhalte.
- Reale Integration/GUI-Abnahme der neuen Statusanzeige in signierter KatoSync-App auf M2/M3/Windows mit Offline-/Resume-/Git-Änderungs-/Job-TTL-Tests.
- Weiterhin separate 4.0-P0-Gates: Gemma/OpenClaw-Agent-Birth, ownerbestätigter SAS/mTLS-Mesh-Transport, Remote-Job-E2E, Billing und Release-Polish.

**Nutzungseinschätzung 04.11.2026:** vorhandene signierte Stage35e-Apps auf M2/M3 eignen sich für **beaufsichtigte Projektübersicht, read-only Repository-Prüfung und QA-Jobstatus**. Der neue Smart-Flow-Slice ist noch nur Quellcode/Frontend-Build und nicht auf beiden Macs notarisiert ausgerollt. Vollautonome Schreib-/Deploy-/Remote-Aufträge noch nicht produktionsreif.
