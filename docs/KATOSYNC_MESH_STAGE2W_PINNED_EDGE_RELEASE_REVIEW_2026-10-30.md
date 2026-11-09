# KatoSync Mesh Stage 2W – Offline-Paketprüfung für den Inbox-Edge-Rollout

**30. Oktober 2026.** Ergänzung auf Stage 2V / Draft-PR #188. Keine Migration, kein Cloud-Deployment und keine echte Gerätepaarung.

## Zweck

Die Windows-CI und die echte synthetische M2↔M3-Netzwerkprüfung sind grün. Damit vor einem **separat genehmigten** QA-Rollout exakt der zuvor überprüfte Code verwendet wird, ergänzt Stage 2W einen reproduzierbaren, **netzwerkfreien Prüfbericht** über beide produktiven Deno-Einstiegspunkte und alle fünf relevanten Edge-Quelldateien.

```bash
node scripts/qa-mesh-inbox-edge-package-review.mjs \
  --snapshot /pfad/zum/aktuell-erstellten-nicht-geheimen-baseline-snapshot.json
```

Der Prozess führt ausschließlich lokale Lesezugriffe und einen In-Memory-Build mit `esbuild` aus. Er erzeugt keine Dateien, erfragt keine Geheimnisse, ruft kein Supabase-API auf und kann **keine** Bereitstellung durchführen. Ein fehlender oder falscher Snapshot führt zum Abbruch.

## Prüfschema

- Der bereits eingeführte `qa-mesh-inbox-rollout-gate.mjs` verifiziert die **vier unveränderten SQL-Dateien** mit ihren fest hinterlegten Byte-SHA256-Werten und den Bestand des Basis-Mesh-Schemas.
- Zusätzlich werden die fünf release-relevanten Quelltexte mit **festen** SHA256-Werten geprüft: `mesh-inbox-send/index.ts`, `send.ts`, `mesh-inbox-receive/index.ts`, `receive.ts` und `mesh-device-enrollment/membership-gate.ts`. Bei einer einzigen Byte-Abweichung bricht die Prüfung ab; keine automatische Nachsignierung.
- Beide Deno-Einstiegspunkte werden **vollständig mit echten relativen Importen** im Speicher zu neutralen ES-Modulen gebündelt. Der Prüfer verlangt, dass sowohl `Deno.serve` als auch die fail-closed `INBOX_NOT_CONFIGURED`-Kontrolle, das bestehende `remoteJobsEnabled`-/`paired`-Antwortschema und die tatsächlich eingebundene Membership-Guard enthalten sind. Die Empfänger-Funktion muss darüber hinaus den gemeinsamen Verifizierer aus `mesh-inbox-send/send.ts` nutzen.
- Der separat gelieferte **aggregierte** Baseline-Snapshot wird mit der bestehenden erwarteten Registry-, Berechtigungs-, Migrations- und Edge-Inventarprüfung validiert. Er enthält **keine** Geräte-IDs, Namen, Schlüssel, Benutzer-IDs oder Credentials.
- Ausgabe: je zwei geprüfte Modulbündel-SHA256, deren Byte-Größe, fünf Source-SHA256, vier Migrations-SHA256, erwartete Migrationsreihenfolge und explizit `REVIEW_ONLY_NO_DEPLOYMENT`, `authorizedToDeploy:false`, `activationFlagsApplied:false`, `trustEnabled:false`, `remoteJobsEnabled:false`.

Die beiden erzeugten **reinen In-Memory-Bundles** wurden zum Zeitpunkt der Abnahme erfolgreich geprüft. Dies bestätigt Importauflösung und TS-Transpilation; es ist **keine** tatsächliche Supabase/Deno-Edge-Ausführung und kein funktionierender JWT-Nachweis.

## Vor jeder echten QA-Bereitstellung zu bestätigen

1. Der **gesamte gestapelte PR-Stack** einschließlich Stage2W ist unabhängig geprüft, Windows-CI, Web-Build und Rust-Format sind am exakten Head grün; der Release-Lock ist bewusst weiter aktiv.
2. Der Snapshot wurde **gerade erst read-only aus dem richtigen Supabase-Projekt** erhoben: genau zwei erkannte, null verbundene Geräte, null Einladungen und keine unerwarteten SQL-/Edge-Änderungen. Ein vergangener Snapshot zählt **nicht** als Freigabe.
3. Das Ziel ist das gemeinsame Projekt `xbnnlyyxiilklsygxcof`, dessen andere KATOOS-Dienste unangetastet bleiben müssen. Kein `supabase db push` auf *alle* offenen Migrationsdateien, kein `functions deploy` ohne genaue Funktionsnamen, keine `--no-verify-jwt`-Option.
4. **SQL-Reihenfolge:** 2L → 2O → 2O.1 → 2S, ausschließlich diese vier SHA256-geprüften Dateiinhalte. **Danach** Prüfung von RLS, clientseitigem Schreib-/Lesesperren, Proof-Key-Constraints, Service-Grants, Triggern und null echten Einladungen.
5. **Edge-Reihenfolge:** `mesh-inbox-send`, `mesh-inbox-receive`; beide mit Plattform-JWT-Verifizierung aktiv und **ohne** gesetzte `KATOSYNC_MESH_INBOX_STAGE`- und `KATOSYNC_MESH_INBOX_RECEIVE_STAGE`-QA-Schalter. Beide Endpunkte müssen bei deaktiviertem QA-Flag **503 INBOX_NOT_CONFIGURED** zurückgeben. Erst danach wird ein separat kontrolliertes QA-Zeitfenster erwogen.
6. **Rollout abbrechen:** Versions-/Hashabweichung, Edge- oder Trigger-Drift, unerwartete Client-Grants, falsche Owner-/Mitgliedschaftsrechte, echte Einladungen oder Trust-Änderung, nicht grüne Plattform-CI, fehlender unabhängiger Betreiberentscheid. Weil SQL-Änderungen nicht automatisch rückgängig gemacht werden dürfen, benötigt der Betrieb einen kontrollierten Rollback-/Restore-Plan.

**Wichtig:** Diese Stufe erstellt nur eine verifizierbare Software-Liefergrundlage. Sie ersetzt weder eine explizite Betreiberfreigabe für den geteilten produktiven Supabase-Dienst noch den späteren echten Keychain-SAS-/mTLS-Test auf zwei Geräten.
