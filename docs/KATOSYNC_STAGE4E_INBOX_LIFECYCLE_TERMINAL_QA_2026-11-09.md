# KatoSync 4.0 — Inbox-Terminalzustände: sicher schließen, nicht freigeben

**09.11.2026 · QA-only · kein produktiver Deploy · Release-HOLD**

## Ausgangsbefund

Die bestehende Mesh-Inbox-Tabelle `katosync.mesh_invites` kennt
`pending`, `accepted`, `rejected`, `cancelled` und `expired`.
Die historischen und separat begutachteten Trigger
`mesh_inbox_resolution_guard()` und
`mesh_inbox_resolution_proof_guard()` erlauben im aktuellen
Datenbankschema aber ausschließlich die signierten
`pending → accepted/rejected`-Entscheidungen, deren Proof an
Empfängergerät, Besitzer, Request-ID und Schlüssel gebunden ist.

Die Stage4E-Atomicschranke lehnt nach einer Kündigung bzw.
nach Trial-Ende außerdem jedes normale Inbox-UPDATE ab.
Deshalb brauchten wir einen eng begrenzten **rein restriktiven
Terminalabschluss**, der auch im Sicherheitsnotfall möglich ist.
Das ersetzt keine autorisierte Benutzerhandlung und erteilt
**keine Mesh-, Peer-Trust-, mTLS- oder Remote-Job-Rechte**.

## QA-only Umsetzung ohne historischen SHA-Eingriff

Die **originalen** SQL-Fixtures bleiben vollständig unangetastet,
einschließlich ihrer separat nachgeprüften SHA-256-Hashes.

`scripts/qa-mesh-inbox-lifecycle-overlay.mjs` darf nur mit
`KATOSYNC_INBOX_LIFECYCLE_QA_ONLY=LOCAL_DISPOSABLE_PG17` und
einem privaten `/tmp/ksmeshqa.XXXXXX/inbox_lifecycle_overlay.sql`
ausgeführt werden. Das Skript:

1. verifiziert die exakten unveränderten SHA-256-Quellen der beiden
   historischen Decision-/Proof-Funktionen und des Stage4E-Atomic-
   Guard-Entwurfs;
2. generiert ausschließlich in dem lokalen 0700-Wegwerfcluster
   **transaktionslokale QA-Overrides**. Die bestehenden
   Annahme- und Ablehnungszweige bleiben bytegenau aus den
   ursprünglichen SQL-Funktionsdefinitionen übernommen;
3. ergänzt bei `cancelled/expired` nur einen strikt validierten
   Zusatzpfad, der die Eigentümer-, Geräte-, Signatur-, Nonce-,
   Zeit- und Proof-Identität vollständig unveränderlich hält;
4. verweigert direkte Benutzerschreibrechte; nur der bestehende
   privilegierte Datenbankdienst `service_role` darf den
   ausdrücklich owner- und request-gebundenen
   `mesh_inbox_terminal_close_qa(owner,request,state)`-Aufruf
   ausführen. Diese Datenbankrolle ist **nicht identisch mit dem
   nachgewiesenen Endbenutzer**;
5. erzwingt `pending → cancelled` **vor** dem Ablaufdatum und
   `pending → expired` **nach** dem Ablaufdatum; akzeptierte
   oder abgelehnte Einladungen sind endgültig abgeschlossen;
6. verwendet `SELECT … FOR UPDATE` auf genau der
   Einladung. Eine zweite Annahmeentscheidung muss warten
   und darf danach nichts mehr ändern;
7. erstellt in **derselben Datenbanktransaktion** einen
   minimalen `mesh_inbox_lifecycle_audit_qa`-Eintrag
   (Owner, Request, bisheriger/neuer Status, DB-Rolle,
   Zeitpunkt). `UNIQUE(request_id)` verhindert mehrfachen
   Auditabschluss, auch bei wiederholten Aufrufen. Es
   werden keine signierten Payloads oder Zugangstokens
   in den neuen Auditdatensatz kopiert.

Das schließende RPC liefert `closed`, `already_closed`,
`not_pending`, `wrong_deadline` oder `not_found`,
statt bei Wiederholung fremde Signaturen aufzubrauchen.
Der gewählte `state` ist ausschließlich `cancelled`
oder `expired`.

## Echte Postgres-17-QA und Race-Test

```sh
bash scripts/qa-mesh-postgres-local.sh inbox-lifecycle
```

Der Runner öffnet ausschließlich einen frischen 0700-Ordner mit
lokalem Unix-Socket und **deaktiviert TCP**. Beim Ende entfernt
er Datenbankdateien und generierte SQL-Overrides.

`tests/sql/mesh_inbox_terminal_lifecycle_disposable_qa.sql`
prüft mit synthetischen Eigentümern und Geräteschlüsseln:

- `pending → accepted` über den unveränderten alten
  Empfänger-Key-Proof- und Source-Key-Guard funktioniert weiterhin;
- falscher Owner und vorzeitiger `expired`-Versuch dürfen
  keine Einladung verändern;
- direkt manipulierte `signed_offer`, Nonce, IDs,
  Geräte, Proof oder falsche Terminalzeit sind unzulässig;
- nach Pro-Policy-Löschung, KatoSync-Membership-Revocation
  und Gerätewiderruf funktionieren die **sicherheitsbezogenen**
  `cancelled`- und `expired`-Abschlüsse weiterhin;
- erneuter identischer Aufruf ist idempotent;
  es erfolgt kein weiterer Audit-INSERT;
- `anon` und `authenticated` erhalten weder
  Eigentumsüberschreibungs- noch Lifecycle-/Audit-Rechte;
- das ursprüngliche akzeptierte Ergebnis und sein
  Signaturbeweis bleiben dauerhaft unverändert.

`tests/qa/meshInboxLifecycleRaceStage4E.mjs` nutzt zwei echte
unabhängige `psql`-Sitzungen: Session A sperrt eine
`pending`-Einladung, wartet und storniert. Session B
versucht währenddessen eine signierte Empfängerannahme.
B wird durch die PostgreSQL-Zeilensperre aufgehalten;
nach A-Commit liefert B **keine angenommene Zeile**.
Audit und endgültiger Status bleiben genau einmal
`cancelled`, auch nach Replay.

**Beobachtete lokale Erfolgsmarker:**

- `KATOSYNC_INBOX_LIFECYCLE_LEGACY_SIGNED_DECISION_UNCHANGED_PASS`
- `KATOSYNC_INBOX_LIFECYCLE_OWNER_SCOPE_PAYLOAD_LOCK_PASS`
- `KATOSYNC_INBOX_LIFECYCLE_CANCEL_EXPIRE_AFTER_REVOCATION_PASS`
- `KATOSYNC_INBOX_LIFECYCLE_CLIENT_GRANTS_AND_AUDIT_PASS`
- `KATOSYNC_INBOX_LIFECYCLE_CANCEL_VS_ACCEPT_SERIALIZED_PASS`
- `KATOSYNC_INBOX_LIFECYCLE_LATE_RECIPIENT_DECISION_DENIED_PASS`
- `KATOSYNC_INBOX_LIFECYCLE_IDEMPOTENT_AUDIT_NO_DUPLICATE_PASS`
- `MESH_QA_ALL_SQL_ASSERTIONS_PASSED`

Zusätzlich liegen sieben statische und negative Node-Vertragstests
in `tests/meshInboxTerminalLifecycleStage4E.test.ts`.

**Gesamte M2-Lokalabnahme, 09.11.2026:** alle drei
isolierten PostgreSQL-17-Läufe `inbox-lifecycle` (inklusive
zweier paralleler realer psql-Sessions), `inbox-proof`
(historischer signierter Empfängerbeweis) und
`quota-stage4e-atomic-writes` (inklusive parallelem Policy-
Widerruf) bestanden. Die vollständige Node-Regression
**788/788**, Remote Usage **16/16**, TypeScript/Vite Build,
Rust-Format, Bash-Syntax und Git-Diff-Prüfung sind ebenfalls
grün. Deno-Edge-Deploy, produktives KatoOS und echte
Besitzerzustimmung wurden NICHT getestet oder verändert.
GitHub-CI ist unabhängig auf dem finalen Commit zu prüfen.

## Klar abgegrenzte Sicherheitsgrenzen

- **KEINE produktive Migration:** Es gibt keine neue Datei
  in `supabase/migrations/`, kein DB-Push, keinen
  Edge-Deploy, keine Migration-History-Mutation und
  keinerlei Änderung an echten Kunden-/Gerätestammdaten.
- **KEINE authentifizierte Endbenutzeraktion:** Das
  owner-gebundene RPC kontrolliert die Parameter und
  die privilegierte Service-Rolle. Es beweist nicht,
  dass der konkrete Besitzer die Stornierung beantragt
  hat. Vor produktiver Nutzung ist ein gesonderter
  authentifizierter KatoOS-Edge-Endpunkt mit aktuellen
  Benutzer- und Mitgliedschaftsprüfungen und einem
  unterschriebenen Audit-Konzept erforderlich.
- **KEIN unbegrenztes Cleanup:** Nur `pending` wird
  abgeschlossen. Bereits `accepted/rejected` erhalten
  weder neue Vertrauensrechte noch eine nachträgliche
  stille Stornierung. Andere alte Payloads werden
  nicht automatisch gelöscht.
- **KEINE produktionsreife Abnahme:** Erst auf einem
  separaten realen Staging-Schema die kombinierte
  Trigger-Reihenfolge, Grant/RLS, Timing,
  Neuinstallation, Rücknahme und Datenmigration mit
  einem unabhängigen Reviewer bestätigen.
- **Weiterer Hauptmasterplan:** Stage4E Free0/Pro10
  und atomare Guards, Stage4F Abo-/Trial-Synchronisation,
  zweite unabhängige Reviewerperson, native
  Ed25519-Key-Pins, M2/M3-SAS/mTLS und gesperrte
  Remote-Job-Aufträge bleiben Release-Gates.

**PR #247 bleibt Draft. Die QA beweist die sichere
Umsetzbarkeit, nicht den produktiven Rollout.**
