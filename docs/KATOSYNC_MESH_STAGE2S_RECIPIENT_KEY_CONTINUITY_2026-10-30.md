# KatoSync Mesh Stage 2S – Empfänger-Schlüsselkontinuität vor Entscheidung

**30. Oktober 2026 · separater QA-Draft, Stack auf Stage 2R / PR #184 · kein Live-Rollout.**

## Sicherheitsfund

Stage 2O/2O.1 hat bereits die **Ed25519-Gerätesignatur des Empfängers** im Edge verifiziert und einen per Nonce gesperrten Nachweis gespeichert. In der Datenbank wurde bisher jedoch nicht gespeichert, **welcher öffentliche Empfängerschlüssel** diesen Proof signiert hat. Die Resolution-Trigger kontrollierten den aktuellen Status des Empfängergerätes und die passende Proof-ID, aber keinen Vergleich *ursprünglicher geprüfter Empfängerschlüssel ↔ aktueller registrierter Schlüssel*. Bei Schlüsselrotation zwischen Proof-Erstellung und Invite-Entscheidung war der Bindungsvertrag unvollständig.

## Stage 2S – additive Migration

`20261030093323_mesh_inbox_recipient_key_continuity.sql` wurde mit `supabase migration new` angelegt und **ausschließlich lokal** getestet. Sie muss als **vierte** Inbox-Migration **nach** Stage 2L, 2O und 2O.1 installiert werden.

- `mesh_inbox_proofs.signing_public_key` speichert exakt den vom Edge anhand der Empfängersignatur geprüften öffentlichen Schlüssel. Die additive, bewusst `NOT VALID`-gekennzeichnete Check-Constraint lässt bereits bestehende historische Proofs unberührt, erzwingt aber für **jede neue Zeile** einen korrekt geformten, nicht leeren Key. Bereits bestehende Nachweise ohne Key dürfen keine **neue** Entscheidung legitimieren.
- Ein neuer **SECURITY INVOKER**, geschützter `BEFORE INSERT`-Trigger prüft Owner, Geräte-ID, `discovered`, Nicht-Widerruf und exakte Public-Key-Übereinstimmung, bevor der Nachweis gespeichert wird.
- Ein separater geschützter `BEFORE UPDATE`-Trigger auf `mesh_invites` verlangt dieselbe Kontinuität zwischen gespeicherter Proof-ID und **aktuell** registriertem Empfänger-Key, bevor `pending → accepted/rejected` wirksam werden darf. Die bereits bestehenden Guards auf Owner, Sender, Anfrage, Aktion, Frische und Einmaligkeit bleiben erhalten.
- Beide Trigger verwenden `FOR SHARE OF d`: Der geprüfte Geräte-Registry-Eintrag wird während der kurzen Datenbanktransaktion gegen gleichzeitige Key-Rotation und Widerruf gesperrt. **Keine** zusätzlichen Rechte für `authenticated`, `anon` oder den Client.
- Edge `mesh-inbox-receive` schreibt den vom Server-Registry-Lookup bekannten `device.signing_public_key` mit dem Proof und kontrolliert im `return=representation`-Beleg die exakte Schlüsselgleichheit. Manipulierte oder falsche Speicherbelege führen zu `INBOX_PROOF_UNCONFIRMED`, bevor der Posteingang gelesen oder eine Einladung entschieden wird.

## Nachweise

`bash scripts/qa-mesh-postgres-local.sh inbox-continuity` führt den **gesamten bisherigen SQL-Migrations-Stack und die Stage-2S-Migration** in einer isolierten PostgreSQL-17-Instanz ohne TCP und ohne externe Datenbankzugriffe aus.

Abnahmefälle: fehlender Key, falscher Key, korrektes Proof, **Key-Rotation nach Proof-Erstellung**, Widerruf vor Entscheidung, unzulässige Wiederverwendung bei anderer Anfrage, erfolgreiche einmalige Annahme und unabhängige Ablehnung. Erfolgsmarker: `MESH_INBOX_RECIPIENT_KEY_CONTINUITY_PASS` und `MESH_QA_ALL_SQL_ASSERTIONS_PASSED`.

Die Node-Integrationstests prüfen zusätzlich den **vorherigen authentischen Ed25519-WebCrypto-Empfängernachweis** samt dem neuen Key-Echo; ein falscher Rückgabeschlüssel blockiert **vor** Posteingangs-GET oder PATCH. Die neue Rolle/Proof-ID bleibt **keine** SAS-, TLS- oder Vertrauensfreigabe.

## Vorbereiteter QA-Rollout (weiterhin gesperrt)

Die vorangehende Stage-2Q-Snapshot-Freigabe erwartet nun **4** Inbox-Migrationen und überprüft auch die neue Spalte, Constraint und **beide Trigger**. Sie erlaubt nur `BASELINE_MATCHES_REVIEW_ONLY` oder `STAGED_SCHEMA_REVIEW_ONLY`, niemals ein automatisches Deployment.

**Verbindliche Migrationsreihenfolge:**

1. `20261029211243_mesh_inbox_signed_send_guard.sql`
2. `20261030072543_mesh_recipient_signed_inbox_atomic_decisions.sql`
3. `20261030074910_mesh_resolution_proof_binding.sql`
4. `20261030093323_mesh_inbox_recipient_key_continuity.sql`

Anschließend erst die separaten Edge- und QA-App-Freigaben, reale signierte M2/M3-Inbox-Tests, beidseitige menschliche SAS-Übereinstimmung, echte gepinnte mTLS-Sitzung mit regelmäßiger Widerrufsprüfung. **Keine** Remote-Reader/Writer-Aktivierung vor diesen zusätzlichen Prüfungen.

**Wichtig:** Ein Test ohne produktiven Datenbankzugriff beweist weder echte Geräteidentität noch aktuelle Auth-Sitzung. Bis zum gesonderten Owner-Entscheid bleibt die Live-Datenbank unverändert und keine Gerätepaarung wird behauptet.
