# KatoSync Stage 4E – Produktion vorbereiten, ohne Produktionsrechte zu verändern

**09.11.2026 | QA / NO DEPLOY | Gate P0 | unabhängig zu genehmigen**

## Ausgangslage, erneut LIVE nur lesend bestätigt

Supabase KATOOS, PostgreSQL 17.6, Schema `katosync`. Die derzeit
produktive Funktion `mesh_device_quota_guard()` enthält noch
`coalesce(allowed,2)` und hat **keinen** Policy-Expiry-Check.
Der Quoten-Trigger läuft nur `BEFORE INSERT`.
`mesh_owner_policy.allowed_devices` besitzt aktuell einen **DEFAULT 2**.
Zusätzlich sind vier Geräte in der Registry, davon **null trusted**,
und eine Owner-Policy vorhanden. Keine personenbezogenen Kennungen
wurden für diesen QA-Bericht exportiert oder verändert.

Die Edge-Enrollment-Implementierung prüft Free-0 und Ablauf bereits
serverseitig, aber diese Schicht ersetzt die DB-Enforcement nicht.
Ein möglicher privilegierter Service-Role-Bug bei `UPDATE owner_user_id`
wurde bereits in disposable PostgreSQL reproduziert; daraus folgt
**kein nachgewiesener öffentlicher Angriff auf Produktion**.

## Neue überprüfte Quelle – absichtlich nicht deployfähig

- `release-candidates/stage4e/qa_only_hardening_candidate.sql`
  – Free 0 ohne Server-Policy, Pro/Trial 1..10 nur bei explizitem
  `allowed_devices`, policy_expiry nach `clock_timestamp()`,
  `FOR SHARE`-gesperrte Policy und vorhandener per-owner
  `pg_advisory_xact_lock`, identitätsstabile Device-UPDATEs,
  `SECURITY INVOKER`, unveränderte RLS-/Server-Only-Rechte.
  Der bisherige Policy-Standardwert 2 wird **entfernt**, sodass
  nur eine explizite administrative Allokation ein Paid-Kontingent gibt.
- `release-candidates/stage4e/qa_only_emergency_freeze.sql`
  – **sicherheitsorientierter Notfallstopp** sämtlicher NEUER
  Registrierungen; bestehende Geräte, Identity-Update-Guard, Status,
  RLS und Entitlements bleiben erhalten. Dies ist keine Rückkehr zum
  verwundbaren alten Free-2-Trigger und kein normales Rollback
  der Verfügbarkeit.
- Beide Dateien verweigern die Ausführung, solange nicht
  `katosync.qa_disposable=unix-socket-qa-only` **transaktionslokal**
  gesetzt ist und ein Unix-Socket ohne TCP vorliegt. Die Dateien
  befinden sich NICHT im Supabase-Migrationsordner. Dieser QA-
  Konfigurationsschalter ist ein zusätzlicher Fehlbedienungsschutz,
  **keine** echte menschliche Freigabe-/Autorisierungstechnologie.

## Echtes, isoliertes PostgreSQL-17-QA-Protokoll

Kommando:
```sh
bash scripts/qa-mesh-postgres-local.sh quota-stage4e-release-candidate
```

Der Runner legt automatisch ein frisches, privates Postgres-Cluster in
`/tmp/ksmeshqa.*` an; TCP ist abgeschaltet und wird negativ geprüft.
Der Test verwendet ausschließlich synthetische Auth-User und Daten.
Durchgespielt:

1. Schema/RLS/Trigger-Preflight und transaktionslokaler QA-Schalter.
2. Kein Policy-Eintrag = **Free 0**; fehlende explizite
   `allowed_devices` wird als DB-Fehler verweigert.
3. Pro 10 akzeptiert genau zehn, verweigert ein elftes Gerät,
   unabhängig von Browser-Tier-Angaben.
4. Abgelaufene oder gelöschte Policy verweigert neue Registrierung;
   existierende Registry-Einträge bleiben erhalten.
5. Privilegierter Geräte-Owner-/Signing-Key-Transfer wird verhindert,
   legitime Status-/Presence-Metadaten bleiben aktualisierbar.
6. `anon` und `authenticated` erhalten keine DML-/Trigger-
   EXECUTE-Rechte.
7. Nach COMMIT des Notfall-Stopps werden **alle** neuen Anmeldungen
   verweigert – selbst bei Pro – ohne Löschung oder Besitzerwechsel
   bereits registrierter Geräte.

Erfolgreiche Marker:
`KATOSYNC_STAGE4E_CANDIDATE_PREFLIGHT_INSTALL_PASS`,
`KATOSYNC_STAGE4E_CANDIDATE_FREE0_PRO10_EXPIRY_IMMUTABILITY_PASS`,
`KATOSYNC_STAGE4E_CANDIDATE_EMERGENCY_FREEZE_DENIES_NEW_AND_PRESERVES_EXISTING_PASS`,
`MESH_QA_ALL_SQL_ASSERTIONS_PASSED`.

## Aktuelle technische Abnahme (isolierter M2, 09.11.2026)

- PostgreSQL 17, **nur Unix-Socket**, kein TCP, privater Wegwerfcluster:
  alle drei Candidate-/Expiry-/Emergency-Freeze-SQL-Marker und
  `MESH_QA_ALL_SQL_ASSERTIONS_PASSED` tatsächlich erfolgreich.
- Sechs neue Stage-4E-Release-Candidate-Vertragstests: **6/6 grün**.
- Gesamte Node-Testsuite nach sequenziellem `npm ci`:
  **764/764 grün**, keine ausgelassenen Node-Tests.
- Remote Usage: **16/16 grün**; TypeScript-/Vite-Build:
  **erfolgreich**, 1.911 verarbeitete Module.
- Native Rust-Formatprüfung, Bash-Syntax und Git-Diff-Check:
  **erfolgreich**. Keine Rust-Quelldatei geändert.
- Diese Tests beweisen **weder** bezahlte Live-Berechtigungen noch
  unabhängige Human Reviewer oder reale M2/M3-Jobausführung.
  Es gab keinen Produktions-DDL-Aufruf und kein automatisches Merge.

## Freigabe- und Produktions-Rollout — NO-GO bis alles erfüllt ist

1. **Migrationsquelle:** Die sieben bereits installierten regulären
   `supabase/migrations`-Versionen und acht SHA-geschützten
   historischen QA-Fixtures bleiben unverändert. Nur nach formaler
   Genehmigung eine **neue** echte Migrationsdatei mit
   `supabase migration new <name>` anlegen; aus der QA-Vorlage
   überprüften SQL-Code übernehmen, ohne den QA-Schalter als
   vermeintliche menschliche Freigabe auszugeben.
2. **Unabhängigkeit:** Mindestens zwei voneinander verschiedene,
   berechtigte und echte KATOOS-Konten, unabhängiger Reviewer-KEY,
   out-of-band Fingerprint, Gate9/10 signierter Review und
   native Key-Pin-Abnahme. Keine automatische Selbstfreigabe.
3. **Datenbank- und API-Scope:** RLS/GRANT und Security Advisors,
   laufende Enrollment-/Inbox-/Relay-/Remote-Job-Endpunkte, Owner-
   Membership, Membership Revocation, Trial-/Pro-Entitlement und
   Statuswechsel getrennt abnehmen; niemals `user_metadata` oder
   ein unfrisches, allein clientseitiges Plan-Flag als Autorität.
4. **Bestehende Identitäten:** Aktuelle Geräte-Zähler je Owner,
   Platzbelegung bereits registrierter und widerrufener IDs sowie
   vorhandene Policy-Reihenfolge prüfen. Die Kandidatenfunktion
   zählt **alle** registrierten Identitäten gegen das Limit, auch
   revoked; davon getrennt Peer-Trust, SAS, mTLS, Remote-Job-Rechte
   und die 10 aktiven Agenten nachweisen.
5. **Vorbereitung:** Plattform-Backups und Wiederanlaufbelege,
   echte *nichtproduktive* Staging-Datenbank als Produktionsabbild,
   Schema-/Code-Diff, TX-/Lock-Timeouts, `clock_timestamp()`
   und konkurrierende Enrollment/Policy-Revoke-Transaktionen
   gesondert abnehmen. Die lokale QA belegt aktuell keine
   produktive parallele Last oder Billing-Reconciliation.
6. **Notfall und Rollback:** Bei Zwischenfall neue Enrollment-
   Anfragen kontrolliert **fail-closed einfrieren**; nicht zur
   alten `coalesce(allowed,2)`-Version zurückkehren. Bestehende
   Identitäten behalten, Buchungen nicht automatisch freischalten
   und Änderungen nur nach einem erneuten unabhängigen Review
   wieder aufnehmen.
7. **Live-Canary:** Erst nach dokumentiertem GO die ausdrücklich
   freigegebene Migration mit der dafür vorgesehenen
   DB-Deployment-Pipeline kontrolliert ausrollen. Anschließend
   read-only Quoten-Triggerdefinition, Policy-Default,
   Identity-UPDATE-Trigger, RLS und Edge-Zustand erneut auslesen;
   Free-0-/Pro-10-/Trial-Expiry-/Account-Switch-/Revocation-
   Negativtests und echten M2/M3-Annahmebeleg durchführen.
8. **Vollständige KatoSync-4.0-Beta:** Nur mit echten Benutzer-
   Zustimmungen, unabhängigen Signaturen, Native Keyring,
   SAS/mTLS, signierten Jobs, CI/Ledger und aktivem Zahlungs-
   Entitlement. `verifiedPercent` bleibt bis dahin `null`.

**Dieser QA-Commit dokumentiert ausschließlich Vorbereitung; er
berechtigt weder zu DDL in KATOOS noch zur Aktivierung von Mesh-Jobs,
Trial-Billing, Deploy oder Merge auf `main`.**
