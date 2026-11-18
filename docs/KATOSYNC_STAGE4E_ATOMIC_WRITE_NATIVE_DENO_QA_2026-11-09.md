# KatoSync 4.0 — Stage4E: Native Deno + atomare Mesh-Schreibfreigabe

**2026-11-09 | NO DEPLOY | PR #247 bleibt DRAFT | unabhängige Freigabe offen**

## Ausgangszustand

Commit-Stand beim Start: `9b1e28d313f699432df5505b57d4a5e8e764e65f`.
Fünf neue `-entitled-qa`-Einstiege und der Boundary-Guard waren
bereits isoliert, vollständig mit Node und neutralem esbuild getestet,
aber **ohne echte Deno-Laufzeit**. Das produktive Supabase Mesh-Projekt
hat weiterhin bereits existierende Funktionen; dieser QA-Baustein
deployt oder aktiviert davon **keine**.

Auch die vorige Stage4E-Datenbankvorlage war ausschließlich im
`release-candidates/stage4e/`-QA-Hold vorhanden. In der
produktiven KATOOS-Datenbank steht beim letzten Read-only-Check
weiterhin der historische `coalesce(allowed,2)`-Fallback.

## 1. Echte Deno 2.9.6-Laufzeit (ohne Netz)

Die Deno-Laufzeit wurde temporär über
`npm exec --yes --package deno@2.9.6` auf dem M2 bereitgestellt;
keine globale Deno-Installation, kein App-Deploy.

Reproduzierbare QA-Aufrufe:

```sh
npm exec --yes --package deno@2.9.6 -- bash scripts/qa-deno-mesh-stage4e.sh
```

Das Skript setzt **keine** `--allow-net`-, Dateischreib-, Run-
oder All-Env-Berechtigungen. Es führt ausschließlich aus:

1. `deno check` für den NEUEN Entitlement-Guard
   `guard.ts` sowie dessen isolierten Deno-Vertrag.
2. Sechs reine, permissionless Deno-Tests gegen den echten
   Guard (`tests/deno/meshEntitlementNativeDenoStage4E.test.ts`).
3. Sechs zusätzliche native Deno-Tests, die **alle fünf tatsächlichen
   QA-Indexmodule importieren** und deren `Deno.serve` VOR dem Import
   abfangen (kein HTTP-Listener); die fünf deaktivierten Gate-Antworten
   und die Ablehnung eines fehlenden Bearer-Tokens werden nachgewiesen.
   Die benötigten `Deno.env`-Variablen enthalten nur SYNTHETISCHE
   Testwerte; Netzwerkzugriff bleibt unter Deno verweigert.

**Lokales Ergebnis:** Deno Guard-Typcheck erfolgreich,
**12/12 echte Deno-Tests erfolgreich**.

Eine vollständige `deno check`-Prüfung aller existierenden
SHA-gepinnten kryptografischen Handler schlägt derzeit mit
**5 bereits vorhandenen TS2345-Typfehlern** fehl
(`Uint8Array<ArrayBufferLike>` versus `BufferSource` im
TS6-Laufzeittypmodell). Dieser Sicherheitscode wurde **nicht**
umgeschrieben. Nur die Original-Entrypoint-Imports werden deshalb
in der QA mit `--no-check` ausgeführt; der neue Guard wird
unabhängig vollständig typgeprüft.
**Das ist ausdrücklich keine vollständige Deno-Release-Abnahme.**
Ein separater, unabhängig geprüfter TS6-kompatibler Crypto-API-Fix
ist vor Production Go erforderlich.

## 2. Atomare PostgreSQL-17-Entitlement-Prüfung (QA only)

`tests/sql/mesh_stage4e_atomic_write_overlay_qa.sql` existiert
ausschließlich im nichtdeploybaren Testordner und ist mit
`katosync.qa_disposable=unix-socket-qa-only` plus TCP-Sperre
gegen versehentliche Live-Ausführung geschützt.

Acht neue `SECURITY INVOKER`-Trigger auf den tatsächlich
existierenden KatoSync-Tabellen prüfen bei jeder sensiblen
Schreiboperation **in derselben PostgreSQL-Transaktion**:

- eine echte `katosync.account_memberships`-Zeile
  mit `access_state='active'` und ohne `revoked_at`;
- eine ausdrücklich vom Server gesetzte
  `katosync.mesh_owner_policy` mit 1 bis 10 Geräten;
- kein abgelaufenes `policy_expires_at`
  (`clock_timestamp()`, nicht der Transaktionsstart);
- stabile `owner_user_id` bei UPDATE;
- `FOR SHARE`-Zeilensperren auf Membership und Policy,
  sowie der bereits verwendete per-owner Advisory-TX-Lock.

Abgesichert sind bei **INSERT**: Mesh-Invites,
Inbox-Single-Use-Proofs, Relay-Message, Relay-Read-Proof,
Enrollment-Challenge. Zusätzlich werden
Invite-Entscheidungen, Challenge-Konsum und
`last_seen_at`-Heartbeat bei UPDATE geprüft.
Geräte-Administrative-Revoke ohne `last_seen_at`
bleibt bewusst möglich, wenn ein Trial abgelaufen ist.

Kommando:

```sh
bash scripts/qa-mesh-postgres-local.sh quota-stage4e-atomic-writes
```

Die vorhandene Bash startet ein frisches,
passwortfreies **lokal isoliertes** PostgreSQL-17-Cluster in einem
0700-Ordner `/tmp/ksmeshqa.XXXXXX`, schaltet TCP ab und
entfernt den Wegwerfcluster per Trap.

Nachgewiesene echte DB-Operationen:

- aktiver Pro-Besitzer kann eine zulässige signierte
  Einladung, Relay-Read-Proof und Heartbeat schreiben;
- Free 0 verbietet Inbox-Proofs, Relay-Reads/-Writes,
  neue Einladungen, Enrollment-Challenges, Heartbeats
  und Annahme bereits vorhandener Einladung;
- widerrufene KatoSync-Mitgliedschaft blockiert
  trotz existierender Pro-Policy neue Mesh-Schreiboperationen;
- nach Trial-/Policy-Ablauf wird auch eine weiter bestehende
  `allowed_devices=10` nicht als laufende Autorisierung akzeptiert;
- Nutzerrollen `anon` / `authenticated` erhalten
  weder DML- noch Trigger-EXECUTE-Rechte;
- Gerätewiderruf bleibt auch nach Abonnement-Ende möglich.

### 3. Reales Rennen: gleichzeitiger Write und Revoke

`tests/qa/meshAtomicEntitlementRaceStage4E.mjs`
wird nur innerhalb desselben Wegwerfclusters gestartet.
Die Datei prüft zuerst den exakten privaten Unix-Socket,
den Ordner-Modus 0700 und die lokale Portnummer.
**Keine entfernte Datenbankverbindung ist möglich.**

Die erste unabhängige psql-Session schreibt als
`service_role` in einer Transaktion einen legitimen
Relay-Read-Proof, hält dabei per-owner Advisory- und
Policy-Row-Lock und wartet innerhalb der Transaktion.
Eine zweite psql-Session versucht gleichzeitig,
`policy_expires_at` zu widerrufen. Sie wird bis zum
Commit der ersten Session aufgehalten. Unmittelbar
danach wird dieselbe Operation mit einem **neuen**
Nonce abgewiesen. Ein zusätzlicher Count beweist,
dass der abgewiesene Proof nicht gespeichert wurde.

Erfolgsmarker:

- `KATOSYNC_STAGE4E_ATOMIC_POSITIVE_BOUND_WRITES_PASS`
- `KATOSYNC_STAGE4E_ATOMIC_FREE0_WRITES_BLOCKED_DEVICE_REVOCATION_PASS`
- `KATOSYNC_STAGE4E_ATOMIC_MEMBER_REVOCATION_BLOCKS_WRITE_PASS`
- `KATOSYNC_STAGE4E_ATOMIC_GRANTS_FAIL_CLOSED_PASS`
- `KATOSYNC_STAGE4E_ATOMIC_REVOKE_RACE_SERIALIZED_PASS`
- `KATOSYNC_STAGE4E_ATOMIC_POST_REVOKE_WRITE_DENIED_PASS`
- `MESH_QA_ALL_SQL_ASSERTIONS_PASSED`

**Alle Marker in der echten isolierten PostgreSQL-17-QA beobachtet.**

## 4. Verbleibende bewusste Schranken

1. Der alte **Inbox-Resolution-Trigger** akzeptiert nur
   `accepted`/`rejected`, nicht `cancelled` oder `expired`.
   Eine administrative Stornierung nach Subscription-Ende ist
   deshalb NICHT durch dieses Paket verfügbar; wir haben keine
   Umgehung des alten kryptografisch abgesicherten Verfahrens
   eingebaut. Ein eigener auditierter Lifecycle-Fix ist nötig.
2. Deno-Native-Tests beweisen Guard, Index-Initialisierung,
   Default-off und Auth-Deny, **nicht** eine komplette echte
   Supabase Edge Runtime mit externem PostgREST / Auth.
3. Die SQL-Trigger schützen **Schreibtransaktionen**.
   HTTP-GET-Readback, native mTLS-Sessions und echte Remote-Job-
   Start-/Resume-Pfade benötigen weiterhin eigene,
   authentifizierte und zeitnahe Berechtigungsgates.
4. Die Policy-Registry ist aktuell nicht automatisch durch
   die gesamte Stripe-Zahlungskette inklusive Kündigung,
   failed payment und 14-tägigem Trial-Ende angebunden.
5. Eine echte aktive unabhängig überprüfte zweite Person,
   der native Ed25519-Key-Pin, Besitzer-Freigabe,
   M2/M3-SAS- und Revocation-Test sowie ein produktives
   Staging-Schema sind noch nicht nachgewiesen.
6. Das Upgrade auf Deno TS6 erfordert einen **separaten**
   signierten Code-Review der SHA-geschützten Handlers,
   keine automatische Hash-Neuberechnung.

## Lokale Gesamtregression (M2, 09.11.2026)

- **779/779** Node-Suite, einschließlich fünf neuer atomarer
  SQL-/Deno-Quellenverträge; keine fehlgeschlagenen Tests.
- **16/16** Remote-Usage-Suite; vollständiger TypeScript-/Vite-Build
  (bekannter nichtblockierender Chunk-Size-Hinweis).
- **12/12** echte native Deno-2.9.6-Laufzeittests und eigenständiger
  Deno-Guard-Typcheck, keinerlei Netzwerkberechtigungen.
- Echter PostgreSQL-17-Disposable-Test mit policy/membership
  `FOR SHARE`, Free0, Pro10/Expiry und Race/Widerruf:
  **sämtliche erwarteten SQL- und Race-Marker grün**.
- Rust-Format, beide Bash-Syntaxprüfungen und
  `git diff --check` erfolgreich.
- Noch NICHT: produktives Supabase Edge Runtime Deployment,
  vollständiger Deno-Typecheck der historischen Ed25519-Handler
  und unabhängige menschliche Freigabe.
- GitHub-CI folgt auf dem endgültigen QA-Commit separat.

## CI

`pr-fast-gate.yml` ergänzt einen reinen Testjob
`Deno Mesh Stage4E QA (no deploy)` mit
`denoland/setup-deno@v2` und auf `v2.9.6` festgelegtem
Deno. Der Job startet ausschließlich den
permissionless Deno-QA-Runner; kein Secret wird geladen,
keine Supabase-CLI-Deploy-Aktion ausgeführt und
keine Remote-Jobs aktiviert. Die Gesamtregression muss
erneut auf dem endgültigen Commit ausgeführt werden.

**Freigabe weiterhin gesperrt: No production SQL, no deployed
Edge functions, no customer rights, no billing, no automatic
reviewer enrollment, no `main` merge.**
