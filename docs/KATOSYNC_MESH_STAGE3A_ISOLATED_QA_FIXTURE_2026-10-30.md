# KatoSync – Stage 3A: Isolierte QA ohne KATOOS-Daten und ohne externe Cron-Jobs

**Stand: 30. Oktober 2026** · aufbauend auf Stage 2Z / [Draft-PR #192](https://github.com/NMKato/KatoSync/pull/192). **Keine Cloud-Ressource erstellt, kein Deployment, keine Änderung an der produktiven Supabase-Instanz.**

## Technische Umsetzung

Neues ausschließlich lokales und vor Ausführung standardmäßig sperrendes Werkzeug:

```bash
node scripts/qa-mesh-isolated-fixture-plan.mjs --offline-synthetic
```

Dieses Werkzeug löst keinerlei Cloud-, Datenbank- oder Shell-Schreibbefehle aus, sondern prüft:

1. Die **vier bytegenau SHA256-gepinnten Mesh-Inbox-SQL-Migrationen** sowie die **fünf SHA256-gepinnten Quellen** der beiden Edge-Dienste samt Membership-Verifizierer. Es verwendet den vorhandenen Stage-2W-Prüfer einschließlich des echten In-Memory-Builds beider Edge-Einstiegspunkte. Jede abweichende Datei blockiert.
2. Die konkrete ausschließlich synthetische PostgreSQL-Aufbauanleitung `tests/sql/mesh_inbox_edge_e2e_setup.sql`: exakt der bekannte KatoSync-Basisschema-Import und die vier Inbox-Migrationen in fester Reihenfolge sowie der feste fiktive Benutzer-UUID. Zusätzliche oder vertauschte Importe führen zum Abbruch.
3. Die geprüften Migrationen und die Fixture dürfen keine unzulässigen Datenbankerweiterungen, Cron-/Netzwerk-Aufrufe, externe HTTP-Verbindungen, Vault-/Storage-Zugriffe oder destruktive Schema-Operationen enthalten. Das ist eine **zweite defensive Prüfung**, kein allgemeiner SQL-Sicherheitsbeweis; unveränderte kryptographische Hashes bleiben die Hauptgrenze.
4. Das tatsächliche Stage-2Z-Wiederherstellungsskript muss noch immer **nur den privaten Unix-Socket ohne TCP** verwenden und den expliziten Restore-Opt-in verlangen. Neu: Eine PostgreSQL-Katalogprüfung weist sowohl in der Fixture-Quelle als auch **nach** `pg_restore` die Abwesenheit von `pg_cron`, `pg_net`, `postgres_fdw`, der `http`-Extension und den `cron`-/`net`-Schemas nach. Eine Abweichung führt zu `MESH_RESTORE_EXTERNAL_JOBS_BLOCKED`. Der positive Abschluss wird nur nach Daten-, RLS-, Grant-, Trigger- und Isolationsprüfung gemeldet.
5. Die Ausgabe deklariert ausdrücklich `OFFLINE_SYNTHETIC_QA_PLAN_ONLY`, `cloudBranchCreated:false`, `cloudDeployment:false`, `productionDataIncluded:false`, `productionCredentialsIncluded:false`, `cronJobsIncluded:false`, `pgNetIncluded:false`, `authorizedToDeploy:false`. Es gibt **keine** automatisierte Cloud-Branch-Erstellung.

Reale lokale Wiederholung nach expliziter synthetischer QA-Freigabe:

```bash
KATOSYNC_MESH_RESTORE_QA_ALLOW=DISPOSABLE_UNIX_SOCKET_ONLY \
  bash scripts/qa-mesh-postgres-recovery-drill.sh
```

Ergebnis auf dem physischen M2: `MESH_RESTORE_DRILL_DATA_FINGERPRINT_MATCH`, `MESH_RESTORE_DRILL_RLS_GRANTS_TRIGGERS_PASS`, **`MESH_RESTORE_NO_CRON_OR_NET_EXTENSIONS_PASS`**, `MESH_RESTORE_DRILL_PASS_DISPOSABLE_ONLY`.

## Cloud-Abgrenzung und reale Kosten

Laut offizieller Supabase-Preisdokumentation kostet ein **Micro-Preview-Branch ab US-$0.01344/Compute-Stunde**. Das entspricht nur für Compute rund **US-$0.32/24 Stunden**, **US-$2.26/7 Tage** und **US-$9.68/30 Tage**. Zusätzliche Speicher-, Netzwerk-, Storage- und sonstige Nutzungskosten können anfallen; **Branch-Compute wird nicht durch Compute-Credits abgedeckt und ist nicht durch den Spend-Cap geschützt**. Diese öffentlich publizierten Beispielpreise sind **keine organisationsspezifische Kostenfreigabe**.

Ein Supabase Preview-Branch erhält seine eigene Datenbank und API-Credentials. Die Dokumentation beschreibt Preview-Branches als **Schema-Umgebungen ohne produktive Daten**, im Gegensatz zum physischen Restore-to-New-Project mit Kopie des gesamten Datensatzes. Trotzdem sind Datenbank-Jobs, Initialisierungs-SQL, automatisch ausgerollte Migrationen und Netzwerknebenwirkungen **vor Erzeugung** zu prüfen. Das KATOOS-Originalprojekt besitzt `pg_cron` und `pg_net` sowie einen aktiven Job. Ein **physischer Cloud-Clone** würde diese potentiell sofort ausführbaren Jobs übernehmen und bleibt deshalb ausdrücklich untersagt, bis sichere Isolation VOR dem Wiederherstellen belegt ist.

**Aktuell bleibt bei Stage 3A einzig die lokale, synthetische, nachweislich Cron-/Net-freie Variante ausgeführt.** Sie ersetzt keinen echten Supabase-Edge-/Auth-/TLS-Test und begründet kein reales Mesh-Pairing.

## Nächste Freigabebedingung

Für die Einrichtung eines **separaten kostenpflichtigen Preview-Branches** brauchen wir die aktuelle organisationsbezogene Abrechnung/Preisbestätigung und die **ausdrückliche Zustimmung** zum finanziellen Aufwand. Danach muss eine unabhängige Kontrolle sicherstellen, dass nicht ein physisches KATOOS-Backup, sondern nur die freigegebene Schema-/Fixture-Basis ohne reale Jobs, Webhooks oder Benutzerdaten ausgerollt wird. Erst dann darf eine getrennte Cloud-JWT/Edge-/PostgREST-QA unter synthetischen Identitäten folgen; die Live-Umgebung und die beiden installierten Mac-Apps bleiben unangetastet.

### Referenzen

- [Supabase – Preview Branch Pricing](https://supabase.com/docs/guides/platform/manage-your-usage/branching)
- [Supabase – Branch Isolation](https://supabase.com/docs/guides/deployment/branching)
- [Supabase – Restore to a New Project (Cron-/Net-Gefahr)](https://supabase.com/docs/guides/platform/clone-project)
