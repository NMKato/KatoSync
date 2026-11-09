# KatoSync Context Pack v1

Der Context Pack ist die lokale, providerneutrale Übergabeeinheit für KatoSync 3.0. Er erweitert die vorhandene Projekt-Memory-Pipeline; er ersetzt weder `scan_roots`, die CURRENT-Aggregate noch die Briefing-Erzeugung.

## Autoritativer Vertrag

- Schema-ID: `katosync.context-pack/v1`
- JSON-Schema: [`context-pack-v1.schema.json`](context-pack-v1.schema.json)
- Kanonisches Artefakt: `CURRENT_CONTEXT_PACK__<device>.json`
- Obsidian-Ansicht: `CURRENT_CONTEXT_PACK__<device>.md`

JSON ist die alleinige maschinenlesbare Wahrheit. Die Markdown-Datei wird aus demselben In-Memory-Datenmodell erzeugt und ist nur eine Ansicht beziehungsweise ein Export.

Der Vertrag enthält ausschließlich diese fachlichen Felder plus die Schema-Version:

- `project`, `goal`, `currentState`, `decisions`
- `activeJobs` mit Pflichtfeldern `owner` und `leaseExpiresAt`
- `blockers`, `evidence`, `nextSafeSteps`, `learnedRules`
- `provenance`, `generatedAt`

Alle Text- und Listenfelder besitzen feste Obergrenzen. Quellen werden deterministisch nach relativem Pfad sortiert; der Erzeugungszeitpunkt wird einmal gesetzt und in beiden Ansichten identisch verwendet.

## Quelle und Sicherheitsgrenze

Die Erzeugung läuft innerhalb von `write_current_files` und verwendet ausschließlich Ergebnisse des bestehenden Scans mit den Kategorien `status`, `roadmap` und `memory`. Sie startet keinen zweiten Verzeichnis-Scan und liest keine Chat-Historien.

Für diese ausgewählten Dateien wird unmittelbar vor der Erzeugung nochmals der bestehende Dateiname-/Inhalts-Secret-Filter angewendet. Sobald eine mögliche Context-Quelle wegen eines Secret-Musters ausgeschlossen wurde, aktuell ein Secret-Muster enthält oder nicht lesbar ist, bricht die Pack-Erzeugung ab. Es werden dann weder Context-Pack-JSON noch Context-Pack-Markdown geschrieben, und ein bereits vorhandener älterer Pack wird entfernt, damit Worker keinen veralteten Stand als aktuell lesen. Der Abbruch ist auf den Pack begrenzt: Aggregate, Briefing und Upload laufen unverändert weiter, der Grund erscheint als Sync-Warnung. Fehlermeldungen geben den Secret-Inhalt nicht wieder.

Andere vom bestehenden Scan ausgeschlossene Dateitypen werden nicht zu Provenance- oder Evidence-Einträgen. Die neuen lokalen Artefakte sind absichtlich nicht Teil von `upload_order`; dieser Foundation-Slice ändert keinen Cloud-Upload.

## Strukturierte Abschnitte in Quellen

Der lokale Parser erkennt deutsche und englische Markdown-Überschriften für Goal/Ziel, Current State/Status, Decisions/Entscheidungen, Active Jobs, Blockers, Evidence/Verifikation, Next Safe Steps und Learned Rules. Nicht zugeordnete Inhalte fließen kategoriebasiert ein:

- `status` → `currentState`
- `roadmap` → `nextSafeSteps`
- `memory` → `learnedRules`

Aktive Jobs werden nur übernommen, wenn alle strukturierten Angaben vorhanden sind:

```markdown
## Active Jobs

- id=job-42; summary=Context Pack prüfen; owner=worker-1; lease=2026-10-05T08:00:00Z
```

Fehlende Angaben werden nicht erfunden. Leere Felder bleiben als leere Zeichenkette oder leere Liste im Vertrag sichtbar.

## Gemeinsamer Verbrauch durch Worker

Zukünftige Codex-, Claude-, Kato-AI- und RDC-Worker sollen denselben Ablauf verwenden:

1. `CURRENT_CONTEXT_PACK__<device>.json` lokal laden. Fehlt die Datei, gibt es keinen gültigen Pack (z. B. nach einem Secret-Abbruch); der Worker arbeitet dann nicht mit geratenem Kontext weiter.
2. `schemaVersion` exakt gegen eine unterstützte Version prüfen; unbekannte Versionen fail-closed ablehnen.
3. `provenance.sourcePolicy` und `generatedAt` prüfen und veraltete Packs kenntlich machen.
4. `activeJobs` nur bei gültigem Owner und nicht abgelaufener Lease übernehmen.
5. Die Aufgabe ausschließlich anhand der begrenzten Pack-Felder planen; Markdown ist nur für Menschen und darf nicht als zweite Wahrheit geparst werden.

Der Vertrag enthält keine Modellnamen, Promptformate oder providerspezifischen Session-Daten. Workeradapter gehören später an die Verbrauchsgrenze, nicht in den Pack.

## Späterer validierter Learnings-Rückweg

Dieser Stand implementiert bewusst keine autonomen Memory-Schreibzugriffe. Ein späterer Rückweg soll getrennt und kontrolliert aufgebaut werden:

1. Worker erzeugt einen begrenzten `LearningCandidate` mit Pack-Version, Quell-Run, Aussage und Evidence-Referenzen.
2. KatoSync legt den Kandidaten in einer lokalen Staging-Inbox ab; kein Worker schreibt direkt in MEMORY- oder Statusdateien.
3. Ein versionierter Validator prüft Schema, Feldgrenzen, Provenance, Secret-Muster, Duplikate und zulässigen Projektbezug.
4. Eine explizite Freigabe entscheidet über die Übernahme in eine autoritative Projektquelle.
5. Erst der folgende normale Scan erzeugt daraus einen neuen Context Pack.

Damit bleibt der Rückweg nachvollziehbar und verhindert, dass ungeprüfte Agentenausgaben selbstständig zur Projektwahrheit werden.

(Created by NMKato Solutions)
