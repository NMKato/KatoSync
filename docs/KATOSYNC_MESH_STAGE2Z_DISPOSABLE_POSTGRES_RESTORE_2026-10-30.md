# KatoSync Mesh Stage 2Z — tatsächlich ausgeführte lokale PostgreSQL-Wiederherstellungsprobe

**30. Oktober 2026** · Aufbauend auf Stage 2Y / [Draft-PR #191](https://github.com/NMKato/KatoSync/pull/191). **Keine Veränderung** an Supabase Cloud, KATOOS-Daten, Keychain, M2/M3-Apps, privaten Schlüsseln, Geräte-Trust oder Remote-Rechten. Keine neuen Cloud-Ressourcen/Kosten.

## Ziel und reproduzierbarer Aufruf

Der bisherige Stage-2Y-Check verifizierte acht **existierende** physische Supabase-Sicherungen, aber keinen Restore. Stage 2Z ergänzt eine **tatsächlich erfolgreich durchgeführte** `pg_dump`→`pg_restore`-Wiederherstellungsübung, **ausschließlich für synthetische KatoSync-Mesh-Fixtures auf dem lokalen M2**.

```bash
KATOSYNC_MESH_RESTORE_QA_ALLOW=DISPOSABLE_UNIX_SOCKET_ONLY \
  bash scripts/qa-mesh-postgres-recovery-drill.sh
```

Ohne dieses exakte opt-in bricht das Skript vor `initdb` mit Exit-Code 2 ab. Es benötigt die bereits installierte Homebrew PostgreSQL-17-Binärdistribution, startet seinen eigenen temporären Cluster unter `/tmp/ksmeshqa.XXXXXX` mit `umask 077` und `chmod 700`, `listen_addresses=''` und einem einzigen privaten Unix-Socket. Ein TCP-Selbsttest muss **fehlschlagen**, sonst wird die Übung beendet. Die Prozedur verwendet **keine** fremden Datenbanken, Supabase-Konten, REST-URLs, Cloud-Backups oder Credentials. Nach jedem Ende werden PostgreSQL und das vollständige temporäre Archiv automatisch gelöscht.

## Gemessene Wiederherstellungsprobe

1. Ein leerer PostgreSQL-17-Cluster wurde tatsächlich erstellt. In der **synthetischen** `postgres`-Quelldatenbank wurden das KatoSync-Basisschema und die vier unveränderten Stage-2L/2O/2O.1/2S-Migrationen in Reihenfolge eingespielt.
2. Der vorhandene signierte Edge→PostgreSQL-End-to-End-Test wurde wirklich ausgeführt: synthetische Ed25519-Identitäten für zwei Geräte, signierte SEND/LIST/ACCEPT/REJECT-Proofs und Ablehnung von Replay und Schlüsselwechsel; danach **2 Devices, 3 Inbox-Invites, 0 Trusted Devices**.
3. Ein echtes komprimiertes PostgreSQL-Custom-Archiv wurde durch `pg_dump --format=custom` erstellt und mit `pg_restore --exit-on-error` in eine zweite, neue Datenbank `recovered` **im selben lokalen Cluster** importiert.
4. Ein Prüffingerabdruck über die vollständigen Datensätze in `mesh_devices`, `mesh_invites` und `mesh_inbox_proofs` ergab vor und nach der Wiederherstellung exakt denselben Wert. Das Archiv wurde mit SHA-256 protokolliert und nach dem Test gelöscht; die Hashes sind wegen zufälliger Fixtures und Zeitangaben pro Testlauf unterschiedlich.
5. **Nach** dem Restore wurde real über PostgreSQL-Kataloge geprüft: RLS auf den drei betroffenen Tabellen aktiv, `authenticated` darf weder Einladungen lesen noch verändern und keine Geräteproofs schreiben; `service_role` behält das benötigte UPDATE-Recht; alle **sechs** relevanten Inbox-Trigger sowie die Empfänger-Key-Constraint sind vorhanden; Device-/Invite-Anzahl stimmt und Trust bleibt null.
6. Zum Abschluss wurde **nur die temporäre Quelldatenbank** verändert: Ein synthetisches Gerät wurde widerrufen. Der Fingerabdruck der Quelle änderte sich, der Fingerabdruck der restaurierten Kopie blieb identisch. Anschließend wurden beide temporären Datenbanken mit dem Cluster gelöscht.

Tatsächliche erfolgreiche Statusmarker:
```text
MESH_RESTORE_DRILL_EPHEMERAL_UNIX_SOCKET_ONLY
MESH_RESTORE_DRILL_DATA_FINGERPRINT_MATCH
MESH_RESTORE_DRILL_RLS_GRANTS_TRIGGERS_PASS
MESH_RESTORE_DRILL_SOURCE_MUTATION_ISOLATED
MESH_RESTORE_DRILL_PASS_DISPOSABLE_ONLY
```

Vier neue Node-Regressionstests kontrollieren Default-Deny, Unix-Socket/kein TCP, echte Backup-/Restore-Befehle, Cleanup und Sicherheitskatalog-Abnahmen. Die Node-Tests führen **keinen Cloud-Zugriff und keinen PostgreSQL-Clusterstart** aus; die tatsächliche Restore-Probe ist ein separater expliziter Mac-QA-Aufruf.

## Grenzen der Aussage und noch offene Freigabe

**Belegt:** Eine selbst erzeugte lokale PostgreSQL-17-Datenbank, bestehend aus den geprüften KatoSync-Fixtures, lässt sich einschließlich Daten, RLS, Tabellenrechten, Triggern und Constraints reproduzierbar wiederherstellen. Sie funktioniert nachher in der Testumgebung.

**Nicht belegt:** Die acht echten Supabase-Backups lassen sich vollständig zu einem arbeitsfähigen KATOOS-Projekt zurückspielen; eine Supabase-Control-Plane-/Edge-/Auth-/Storage-Recovery; externe Rollen-/Credential-Reprovisionierung (die Rollen existieren während des lokalen Restores bereits global im Testcluster); Kosten und Freigabe eines isolierten Supabase-Branches; reales RPO/RTO. Supabase hat `pitr_enabled=false`, daher ist kein zeitgenaues Recovery garantiert. Der lokale Erfolg ändert **nicht** den Live-Freigabestatus.

**Nächster echter Betriebs-Gate:** Kosten und Isolation einer unabhängigen Supabase-QA-Umgebung klären, davor keine neue zahlungspflichtige Ressource anlegen; in dieser Umgebung einen tatsächlichen Cloud-Backup-Restore und anschließend die vier SHA-gepinnten Migrationen samt deaktiviertem JWT-Edge-Send/Receive prüfen. Das gemeinsame Produktivprojekt `xbnnlyyxiilklsygxcof` bleibt unberührt, bis dieser Nachweis und eine ausdrückliche Betreiberfreigabe vorliegen.

## Cloud-Klon-Sicherheitsbefund (read-only, 30.10.2026)

Die aktuellen offiziellen Supabase-Dokumente warnen, dass ein physischer **Restore to New Project** die komplette Datenbank einschließlich externer Datenbankerweiterungen und zeitgesteuerter Jobs übernimmt, die nach dem Restore **sofort aktiv werden können**. Bei unserem gemeinsamen KATOOS-Projekt wurden live ausschließlich lesend **`pg_cron` und `pg_net` als installiert**, in `cron.job` **1 geplanter und 1 aktiver Job** festgestellt. Der Jobinhalt und seine möglichen externen Ziele wurden nicht ausgelesen.

**Konsequenz: Der automatische physische Cloud-Clone ist derzeit ausdrücklich NO-GO.** Vor jedem Cloud-Wiederherstellungsversuch braucht es ein überprüftes Konzept zur externen Netz-/Job-Isolation; lediglich den neuen Klon später zu bereinigen genügt wegen potentiell sofortiger Seiteneffekte nicht. Bevorzugte Alternative für weitere lokale/isolierte QA ist ein **logischer, streng kontrollierter Schema-/Fixture-Export** ohne produktive Cron-Jobs, HTTP-Worker und vertrauliche Nutzdaten. Beide vorhandenen Datenbankerweiterungen bleiben im Live-Projekt unberührt.

Quelle: https://supabase.com/docs/guides/platform/clone-project (Abschnitt Restore to a new project) und https://supabase.com/docs/guides/platform/backups.
