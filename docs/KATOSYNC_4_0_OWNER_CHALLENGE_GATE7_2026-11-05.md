# KatoSync 4.0 – Trust Gate 7: Einmal-Challenge und unabhängige Owner-Freigabe

**QA-Stand 05.11.2026 · Draft / kein Beta-Release · auf PR #237 gestapelt.** Besitzerberechtigungen, bestätigte Feature-Abnahmen und produktive App-Installationen bleiben unverändert.

## Tatsächlich im KATOOS-Supabase-Cluster umgesetzt

Projekt `xbnnlyyxiilklsygxcof`, eigenes Schema `katosync`. Additive SQL-Migration:
`supabase/migrations/20261105084427_katosync_feature_owner_one_time_challenge_gate7.sql`

**Wichtig:** Die Dateiversion wurde nach Anwendung auf den **tatsächlichen Live-Historieneintrag** `20261105084427` abgeglichen. Zuvor bestand ein erfolgreicher SQL-`BEGIN/ROLLBACK`-Trockenlauf.

Drei neue Tabellen (RLS aktiv, ausdrücklich keine Rechte für `anon`/`authenticated`):

| Tabelle | Inhalt |
|---|---|
| `feature_approval_reviewers` | Separat administrativ zugelassene Prüfer, mit gesperrter Reaktivierung widerrufener Prüfrollen |
| `feature_owner_challenges` | Per Konto/Projekt/Grant gebundener 32-Byte-Nonce; Ausgabe-, Ablauf-, Einmalverbrauch- und Abbruchnachweis |
| `feature_owner_review_decisions` | Unveränderliche Entscheidungen mit eigenem Reviewer, referenziertem verbrauchtem Proof und aussagekräftiger Begründung |

Die beiden **`SECURITY INVOKER`-RPCs** `feature_owner_challenge_issue` und `feature_owner_challenge_consume` sind ausschließlich für `service_role` freigegeben; Client- und Anon-Rollen haben **kein EXECUTE**. Zusätzlich verhindern Trigger:

- Ausstellen ohne registriertes aktives Projekt, aktives KATOOS-Mitglied und **zuvor vom Administrator angelegten Pending-Grant**.
- Mehrfache offene Challenges je Grant, mehrere Pending-Keys je Projekt/User, häufigere Neu-Ausstellungen als alle 30 Sekunden und nicht zufällige Nonces (Nonce wird mit `extensions.gen_random_bytes(32)` im Postgres erzeugt).
- Rücknahme von Verbrauch, Überschreiben/Neuverwendung signierter Proofs, widerrufene Rollen ohne neuen Prozess oder spätere Änderung der Entscheiderprotokolle.
- Selbstfreigabe durch die betroffene Person oder einen nicht aktiven Reviewer.
- Aktivierung eines Pending-Grants ohne **innerhalb von 24 Stunden dokumentierten**, bereits verbrauchten Schlüsselbesitz-Nachweis und eine **danach** erteilte `approved`-Entscheidung durch eine andere aktive Person.

**Wichtiges Vertrauensmodell:** Die Ed25519-Signatur wird im vertrauenswürdigen Edge-Backend vor dem atomaren Datenbankverbrauch verifiziert. PostgreSQL verifiziert Ed25519 nicht selbst. Der Berechtigungsentscheid ist derzeit ein admin-verwalteter Datenbanksatz, noch **keine unabhängig kryptografisch signierte menschliche Zwei-Personen-Attestation**. `service_role` ist ein hochprivilegiertes Geheimnis; dessen Kompromittierung bleibt ein P0-Risiko. Vor öffentlichem Release separaten Admin-Prozess mit starker Identitätsprüfung und eigener Reviewer-Signatur ergänzen.

## QA-Edge-Funktion

Deployte, isolierte Funktion `feature-owner-challenge-qa` (Version 1, `verify_jwt=true`):

`https://xbnnlyyxiilklsygxcof.supabase.co/functions/v1/feature-owner-challenge-qa`

Nur `POST` mit strengem JSON-Vertrag und `action: "issue" | "verify"`. Keine CORS-Freigabe, keine `approve`-/`activate`-Route. Die Funktion prüft:

1. Kanonische KATOOS-URL, expliziten QA-Schalter und echten `/auth/v1/user`-Token des jeweiligen Nutzers.
2. Aktive KatoSync-Mitgliedschaft und genau die bereits administrativ vorgemerkte Projekt-Key-Bindung.
3. Bei **issue**: serverseitig gesperrtes Grant, zufällige befristete Nonce aus der Datenbank; `grantsRights:false`.
4. Bei **verify**: Unveränderliche Challenge und registrierter Public Key, korrekte projekt-/kontogebundene Ed25519-Signatur über kanonische Bytes, atomare Nonce-Konsumierung im SQL-RPC. Die Antwort heißt `proof_consumed_pending_independent_review`, niemals `owner_approved`.
5. Fehler, Race Conditions, abgelaufene/gefälschte Signaturen oder Replay werden abgewiesen. Maximale Anfragegröße 2 KiB, HTTP-Timeout 8 s, `Cache-Control:no-store`.

Die Funktion teilt sich den **bereits geprüften** Ed25519-PoP-Verifikator `src/lib/featureOwnerKeyProof40.ts` mit dem QA-Vertrag. Es wurden keine Credentials ins Frontend eingebaut.

## Reproduzierte Tests

- SQL zuerst erfolgreich in einem Transaktions-Rollback geprüft, dann additiv in der echten KATOOS-Datenbank angewandt.
- **Live:** Alle drei neuen Tabellen RLS an, `anon` und `authenticated` besitzen keine Rechte; RPC-EXECUTE ebenfalls verboten. **0** Reviewer, **0** Challenges, **0** Decisions, **0** Grants, **0** Projektfreigaben.
- Die direkte Ausgabe einer Challenge für ein nicht registriertes Projekt/Konto liefert **0 Zeilen**, also keinen umgehbaren Owner-Pfad.
- Live `feature-owner-challenge-qa` ohne JWT: **HTTP 401**. Deployment bestätigt; dies ist ausdrücklich **kein** Test mit einem realen gültigen Anwender-Grant.
- **716/716 Node-Tests bestanden** (kontrollierte Parallelität), darunter sechs neue Gate-7-Tests über Signatur, Replay, Verfallsdatum, HTTP-Vertragsfehler und SQL-Permission-/Reviewer-Policies.
- Isolierter TypeScript-Check der Edge-Dateien und regulärer TypeScript-/Vite-Build mit 1.909 Modulen bestanden. Bestehende Frontend-Chunk-Größenwarnung ohne Build-Abbruch.
- Keine Rust-Produktivcode-Änderungen in diesem Gate; zuvor auf Gate 6 **290/290 Rust-Library-Tests bestanden**, 8 bewusst ignoriert.

## Nächste P0-Freigaben für KatoSync 4.0 Beta

1. **Administrativer Review-Prozess:** Vorheriger eindeutiger Reviewer-Identitätsnachweis mit unabhängiger Zwei-Personen-Autorisierung, überprüfte Projektzuordnung und sicher verwahrter Owner-Public-Key; danach explizite Registrierung, keine automatischen Freigaben.
2. **Echte End-to-End-QA:** Authentifizierte Desktop-App, unabhängige Challenge, Ed25519-Proof, einmaliger DB-Verbrauch, dokumentierte zweite Person, Aktivierung und sofort wirksamer Widerruf. Negative Tests bei Tokenwechsel, Replay, Rollen-/Key-Wechsel.
3. **Gate 8:** append-only **Accepted-Receipts** nur nach dokumentierter realer Owner-Abnahme, geprüften Roadmap-Kriterien, GitHub-CI-Jobs und Git-Ancestry. `verifiedPercent` bleibt sonst `null`, keine ETA.
4. Release- und Mesh-Abnahme auf M2/M3/Windows, Signieren/Notarisierung und kontrollierter Update-/Rollback-Pfad. Aktueller M2-Platz ca. 46 GiB, Ziel ≥80 GiB frei vor größeren Packaging-Builds.

**Fazit:** Gate 7 ist als serverseitiger, fail-closed QA-Prozess eingerichtet und getestet. **Noch nicht:** ein produktiv freigeschalteter Owner, ein akzeptiertes Projektfeature oder eine releasefähige KatoSync-4.0-Beta.
