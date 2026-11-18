# KatoSync Mesh Stage 3O – isolierte QA-Vorprüfung für Inbox und Geräte-Enrollment

**01.11.2026 · NMKato Solutions · DRAFT / ausschließlich offline verifiziert**

## Ursache und Architekturentscheidung

Der bisherige Inbox-Send-/Receive-Code und `mesh-device-enrollment` binden sämtliche Auth-/SQL-Anfragen und die v1-Angebotssignatur fest an den produktiven KATOOS-Supabase-Origin. Fünf relevante Inbox-/Membership-Quelldateien sind absichtlich mit SHA-256 in der unveränderlichen Paketfreigabe geschützt. Eine direkte Modifikation würde eine neue, vollständige Produktions-Sicherheitsfreigabe erfordern.

Stage 3O führt daher **einen separaten QA-only, vollständig lesenden Edge-Handler** ein und lässt alle produktiven Inbox-/Enrollment-Dateien unverändert. Das ist ein Sicherheits- und Integrationsbaustein zur Vorbereitung des späteren Cloud-Tests, **kein freigeschaltetes Inbox- oder Enrollment-Protokoll**.

## Neuer Handler

`supabase/functions/mesh-preview-readiness/` enthält `index.ts` und `handler.ts`. Ein Probelauf akzeptiert ausschließlich POST mit `{"action":"probe"}`, ein bestehendes Online-Bearer-JWT und eine streng konfigurierte Vorschau:

- `KATOSYNC_MESH_PREVIEW_READINESS_STAGE=read-only-probe`
- `KATOSYNC_MESH_RELAY_QA_MODE=isolated-preview-only`
- `KATOSYNC_MESH_RELAY_QA_PROJECT_REF` muss eine genaue nichtproduktive 20-stellige Referenz sein
- `SUPABASE_URL=https://<QA-PROJECT-REF>.supabase.co` exakt, mit passendem `DENO_DEPLOYMENT_ID`
- `SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY` müssen vorhanden und verschieden sein. Die privilegierten Zugangsdaten bleiben ausschließlich serverseitig.

Anmeldung wird auf dem **gleichen geprüften Origin** über `/auth/v1/user` verifiziert. Vor und nach den sieben Tabellensichten wird die aktive KatoSync-Mitgliedschaft mittels des separaten Stage3M-Relay-Adapters geprüft.

Der Handler prüft folgende erwartete Tabellen, **nur mit GET, `select=owner_user_id`, `owner_user_id=eq.<verifizierter-User>` und `limit=1`**:

1. `mesh_enrollment_challenges`
2. `mesh_owner_policy`
3. `mesh_devices`
4. `mesh_invites`
5. `mesh_inbox_proofs`
6. `mesh_pairing_relay_messages`
7. `mesh_pairing_relay_reads`

Die Antwort liefert nur den booleschen QA-Reifezustand und die Anzahl überprüfter Tabellen, keine Gerätekennungen, Einladungen, Tokens oder Datenbankzeilen. Es gibt keinerlei `POST`/`PATCH`/`DELETE` gegenüber PostgREST, keine Migration, keinen Geräte-Trust und keine Ausführung. Redirects, ungültige Konten/Origin-Konfigurationen, suspendierte/revozierte Mitgliedschaft, fehlende Tabellen, Fremd-Owner-Zeilen oder große/kaputte Antworten werden abgewiesen.

Die erfolgreiche Rückgabe `QA_SCHEMA_READ_ONLY_READY` bedeutet **ausschließlich**: Der simulierte bzw. später echte QA-Auth-/Membership-Weg und die sieben lesbaren schema-spezifischen Endpunkte konnten geprüft werden. Sie **beweist nicht**, dass alle Migrationen, SQL-Trigger, RLS-Policies, Cloud-JWT-Konfigurationen oder produktiven Schreibpfade korrekt sind.

## Ausführung und Nachweise

Offline M2-Test:

    node --experimental-strip-types --test tests/meshPreviewReadinessStage3O.test.ts

Mit Stages 3L, 3M und 3N:

    node --experimental-strip-types --test tests/meshPreviewReadinessStage3O.test.ts tests/meshRelayListV2Stage3N.test.ts tests/meshRelayTenantOriginStage3M.test.ts tests/meshPairingRelayStagingContractStage3H.test.ts tests/meshStage3LLoopbackJwt.test.ts

**M2: 7/7 eigene und 23/23 kombinierte Prüfungen bestanden.** Die SHA-256-Invarianten der Produktionsdateien werden im Test zusätzlich bestätigt. Die Mock-Anfragen erlauben keinen Netzverkehr zu Supabase; es wurde weder ein Projekt erstellt noch ein Edge-Dienst veröffentlicht.

## Freigabegrenzen und nächster Schritt

**Noch NICHT erreicht:** ein tatsächlicher Supabase-Preview-Branch mit Kosten-/Restore- und Cron-/pg_net-Isolation, eine dort korrekt konfigurierte Edge-Funktion mit JWT-Gateway, die vollständige Inbox-Send-/Receive-Bereitstellung, echte Registrierung/Discovery, native Rust Auth-/Issuer-Kompatibilität, M2↔M3 Keychain/SAS/mTLS oder Remote-Read-only-Aufträge.

Vor Cloud-QA ist insbesondere ein gesondert geprüfter Origin-gebundener **native Inbox-/Enrollment-Protokollvertrag** erforderlich. Die existierenden fest gepinnten Produktions-v1-Dateien dürfen nicht per URL-Rewrite oder vorgetäuschtem Produktions-Issuer als QA-tauglich eingestuft werden. Stage 3O bleibt ein gestapelter Draft; kein Merge, keine Cloud-Rechnung, keine Freischaltung ohne gesonderte Entscheidung.
