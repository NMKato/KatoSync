# Continuation Recovery – Operator-Prozedur

Werkzeug: `scripts/katosync-continuation-recovery.py` (Tests: `scripts/test-continuation-recovery.py`).
Der Watchdog selbst (`scripts/katosync-continuation-watchdog.py`, übernommen aus `461e226`
auf `feat/local-continuation-watchdog`) bleibt unverändert und fail-closed.

## Warum

Der Watchdog stoppt bei `stopOnFailure=true` korrekt am ersten Fehler, meldet danach aber
nichts mehr. Ein `running/*.json` ohne lebenden Daemon-Besitzer blockiert die Queue
(`queue_busy`) für immer, und ein verschwundener `activeJobId` lässt ihn endlos warten
(`waiting_active`). Alle drei Fälle sahen von außen wie gesunde Heartbeats aus. `status` macht sie
sichtbar. Die Recovery-Schritte sind nur mit expliziten menschlichen Gates möglich.

## Grundregeln

- `status` liest nur, es schreibt nichts (das prüft ein Test per Snapshot).
- Jeder schreibende Befehl ist ohne `--write` ein Dry-run und gibt nur JSON aus.
- Wenn ein Gate fehlt, bricht der Befehl mit Exit 3 (`REFUSED: …`) ab, ohne etwas zu ändern.
- Kein Befehl startet einen Job, wiederholt einen Job, überspringt eine Welle oder löscht Daten.
  Er erzeugt auch kein Outbox-Ergebnis.
- Kandidaten sind immer `enabled=false` und `stopOnFailure=true`. Aktivieren geht nur über `swap --enable`.

## Status

```sh
python3 scripts/katosync-continuation-recovery.py status          # menschenlesbar
python3 scripts/katosync-continuation-recovery.py status --json   # maschinenlesbar, Schema v1
```

Exit-Code `0` = ok, `1` = attention, `2` = blocked (mindestens ein Befund mit Schwere `error`).
`--now <ISO>` macht die Auswertung deterministisch (für Audits und Tests).

| Befund | Bedeutung | Gate |
| --- | --- | --- |
| `PLAN_FAILED` | Plan ist an Welle *n* gescheitert; Welle, Modus, Job und Fehler stehen im Befund | `review_failed_wave` |
| `RUNNING_OUTCOME_UNKNOWN` | `running/<id>.json` hat kein Outbox-Ergebnis, und der Daemon arbeitet nicht an diesem Job (oder sein Heartbeat ist alt), außerhalb der Grace-Zeit | `confirm_outcome_unknown` |
| `CONTINUATION_ACTIVE_JOB_OUTCOME_UNKNOWN` | Der Watchdog wartet auf einen Job, der weder in der Queue liegt noch ein Ergebnis hat | `confirm_outcome_unknown` |
| `DAEMON_HEARTBEAT_STALE` / `DAEMON_STATE_MISSING` | Der Laufzustand des Daemons ist nicht belegbar | – |
| `RUNNING_RESULT_NOT_ARCHIVED` | Es gibt ein Ergebnis, aber die Archivierung ist liegen geblieben (Warnung) | – |
| `QUEUE_OCCUPIED` | Inbox oder Running ist belegt; der Swap ist gesperrt | – |

Einstufung von `running/*.json`: `active` (Daemon ist busy, der Heartbeat ist frisch und `currentJobId`
stimmt überein), `pending_claim` (jünger als `--orphan-grace`, Standard 120 s), `finished_not_archived`
oder `outcome_unknown`.

## Prozedur

1. **Befund sichern:** `status --json > ~/katosync-status-$(date +%Y%m%d-%H%M%S).json`.
2. **Verwaisten Record klären** (nur bei `RUNNING_OUTCOME_UNKNOWN`): Zuerst prüft ein Mensch
   Arbeitsstand, Git-Status und Logs des betroffenen Projekts. Danach:
   ```sh
   … quarantine-running --job-id <id> --confirm-outcome-unknown --note "<Begründung>"          # Dry-run
   … quarantine-running --job-id <id> --confirm-outcome-unknown --note "<Begründung>" --write
   ```
   Der Record wird nach `control/quarantine/` verschoben, zusammen mit einer Notiz
   `<id>.quarantine.json` (`outcome: unknown`). Ein Ergebnis wird **nicht** erfunden.
3. **Folgeplan vorbereiten**. Es gibt zwei Wege:
   - Reviewter Resume ab der gestoppten Welle. Die gescheiterte Welle wird nicht übersprungen,
     bereits erledigte Wellen laufen nicht noch einmal:
     ```sh
     … prepare-resume --acknowledge-failed-wave <wellenname> [--acknowledge-mutating-rerun] \
                      [--acknowledge-outcome-unknown-job <jobId>] [--new-plan-id <id>] [--write]
     ```
     `--acknowledge-mutating-rerun` ist bei `workspace_write`-Wellen Pflicht. Setze es erst,
     nachdem du geprüft hast, dass ein erneuter Lauf auf dem aktuellen Arbeitsstand sicher ist.
   - Neuer Plan: `… prepare-plan --from <datei.json> [--write]`. Eine neue `planId` ist Pflicht,
     und `stopOnFailure=false` wird abgelehnt.

   Das Ergebnis ist `continuation/plan.candidate.json`. Einen vorhandenen Kandidaten
   überschreibt das Werkzeug nie.
4. **Kandidat reviewen** (Diff gegen `plan.json`).
5. **Swap**. Er ist erst erlaubt, wenn der Daemon frisch und idle ist, die Queue leer ist, kein
   aktiver Continuation-Job läuft (Ausnahme: der quittierte unbekannte Job) und die aktuelle
   `planId` exakt bestätigt wurde:
   ```sh
   … swap --confirm-current-plan-id <aktuelle planId>            # Dry-run
   … swap --confirm-current-plan-id <aktuelle planId> --write    # ersetzt plan.json, Plan bleibt deaktiviert
   ```
   Das Werkzeug kopiert `plan.json` und `state.json` nach `continuation/backups/<stamp>-<planId>/`
   und prüft die Kopien per SHA-256 (`manifest.json`). Danach ersetzt es `plan.json` atomar und
   verschiebt den Kandidaten ins Backup. `state.json` bleibt unverändert, denn der Watchdog
   initialisiert ihn für die neue `planId`. Mit `--enable` wird der Plan sofort scharf geschaltet.
   Ohne diese Option bleibt er deaktiviert, und das Aktivieren ist ein eigener, bewusster Schritt.
6. **Kontrolle:** Danach `status` erneut ausführen. Alle Schritte werden in
   `continuation/recovery.log` protokolliert.

## Nicht abgedeckt (bewusst)

- Das Werkzeug installiert oder startet keinen LaunchAgent und keinen Dienst. Die Install-Skripte aus
  `461e226` wurden nicht übernommen.
- Es gibt keinen automatischen Retry und keine Zeitplanung. Jede Wiederaufnahme ist eine
  menschliche Entscheidung.

(Created by NMKato Solutions)
