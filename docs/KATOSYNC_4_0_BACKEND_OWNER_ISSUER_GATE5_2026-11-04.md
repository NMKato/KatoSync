# KatoSync 4.0 – Gate 5: KATOOS-Backend-Freigabestelle

**Datum:** 04.11.2026 · **QA-first, kein produktiver Owner-Grant aktiviert** · Auf dem Draft-Stack #230–#235 aufgebaut.

## Tatsächlich in Supabase eingerichtet

KATOOS-Cluster `xbnnlyyxiilklsygxcof`, EU-Zentralregion, separates Schema `katosync`. Die beiden additiven Migrationen sind in Supabase angewandt, die GitHub-Dateiversionen entsprechen genau der Live-Migrationshistorie:

- `20261104222611_katosync_feature_approver_authority_gate5.sql`
- `20261104222901_katosync_feature_approver_activation_fix_gate5.sql`

Die Migrationen führen drei **neue, ausschließlich serverseitig administrierte** Tabellen ein:

| Tabelle | Inhalt | Schutz |
|---|---|---|
| `katosync.feature_approval_projects` | Explizit registrierte Git-Projekte, Zustand und Freigabedatum | Keine automatische Registrierung; keine normalen Benutzerprivilegien |
| `katosync.feature_approver_grants` | Exakter KATOOS-User, Projekt, Role, Berechtigung, Ed25519-Public-Key und Key-ID, Revision, Widerruf | Nur Admin-/Service-Zugriff; ein aktiver Schlüssel pro Projekt/Konto |
| `katosync.feature_approver_audit` | Änderungsnachweise der Rollen- und Schlüsselzustände | Append-only per Trigger; keine Client-Schreibrechte |

**Live gemessen:** Alle drei Tabellen haben RLS aktiviert, **0** gewöhnliche Benutzer-RLS-Policies, `anon` und `authenticated` haben weder `SELECT` noch `INSERT/UPDATE`; `service_role` besitzt die benötigten expliziten Rechte. Es gibt **0 Projektfreigaben, 0 Approver-Grants, 0 Auditereignisse**. Der Security Advisor weist auf `rls_enabled_no_policy` als **INFO** hin; das ist hier wegen bewusst vollständig gesperrten Clientzugangs gewollt, kein Freigabefehler. [Supabase-RLS-Linter](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Die Trigger sperren Löschen von Projekten/Grants und Änderungen bereits widerrufener Datensätze, verhindern stille Key-Reassignments und erlauben eine einmalige administrative `pending → active`-Autorisierung. Ein separates Korrekturmigration-Skript dokumentiert die geprüfte Zustandsmaschine.

## Tatsächlich bereitgestellte QA-Edge-Funktion

`feature-approver-grant-qa`, Version 1, `verify_jwt=true`:

`https://xbnnlyyxiilklsygxcof.supabase.co/functions/v1/feature-approver-grant-qa`

- Nur `GET ?projectId=...`, exakt ein gültiger Projektbezeichner; keine mutierenden API-Routen und kein CORS.
- Serverseitig /auth/v1/user beim **gleichen KATOOS-Aussteller** geprüft; keine Rollen aus selbst änderbaren JWT-`user_metadata`.
- Live bestätigte aktive Mitgliedschaft, aktives administrativ registriertes Projekt und genau ein aktiver Approver-Grant erforderlich.
- Service-Role-Credential ist ausschließlich Edge-intern, niemals eine Browserantwort. Beträge/Tiers, Mesh-Rechte und Owner-Feature-Approval sind getrennt.
- Kontrollierte Größenlimits, kein Redirect, begrenzter Request-Timeout und `Cache-Control: no-store`.
- Wenn autorisiert: Ed25519 signiertes, **60 Sekunden** gültiges Owner-Grant im kanonischen Rust-kompatiblen Protokoll. Keine Eigenregistrierung.
- **Live-Test:** GET ohne Berechtigung antwortet HTTP **401** (JWT-Gate), ohne sensible Daten.

**Aktivierung absichtlich ausstehend:** Die neu konzipierte Funktion benötigt den Stage-Schalter `KATOSYNC_FEATURE_APPROVAL_STAGE=qa` und einen geheimen PKCS8-Ed25519-Ausstellerschlüssel `KATOSYNC_APPROVER_ISSUER_PKCS8_B64`. Diese Geheimnisse wurden bei der Umsetzung **nicht** hinterlegt; es wurde kein Eigentümerkonto als Approver angelegt. Der Release-Public-Key-Pin muss separat über eine vertrauenswürdige native Release-Konfiguration ausgeliefert werden. Ohne diese Voraussetzungen gibt es **keinen signierbaren echten Grant**.

## Native KatoSync-Integration

Der neue read-only Rust-Bridge-Aufruf nutzt eine **fest definierte HTTPS-URL** des QA-Issuers und überprüft einen frisch geholten Grant mit dem **extern gepinnten** Issuer-Public-Key. Er lehnt Login-/Projektfehler, überlange Antworten, Redirects, Schlüssel- und Signaturabweichungen ab. Der bestehende Gate-4B-Workflow prüft Account, Projekt, Feature-Receipt und GitHub-/Git-Evidenz und verifiziert das KATOOS-Konto am Ende erneut. **Keine Tauri-IPC, keine automatische Annahme, kein produktiver Schlüsselpin.**

Ein fester SHA-256-Testvektor prüft die Rust-/TypeScript-Identität des signierten Grants:

`1f874636616a22ee30ff57ce3f355f92dfedb59ffc437c4c302af6a3a1466561`

## Reproduzierbare QA-Ergebnisse

- **288/288 Rust-Library-Tests bestanden**, 8 planmäßig ignoriert; inkl. fester TS/Rust-Owner-Grant-Signaturvektor.
- **705/705 Node-Tests bestanden** mit begrenzter Parallelität (inkl. 7 neuer Endpoint-/SQL-Sicherheitsverträge).
- Separater TypeScript-DOM/WebCrypto-Check der Edge-Logik und regulärer TypeScript-/Vite-Frontend-Build bestanden (1.909 Module); bestehender Chunk-Size-Hinweis ohne Build-Abbruch.
- Die Edge-Funktion wurde als **Version 2** mit aktivierter Plattform-JWT-Verifikation ausgerollt. Live-GET ohne JWT: **HTTP 401**. Das zeigt die API-Sperre, **nicht** erfolgreiche Owner-Ausstellung.
- Serverseitige Live-Migrationshistorie gegen die Dateinamen abgeglichen, damit der Supabase-DB-Push nicht wegen abweichender lokaler Zeitstempel dieselben Tabellen nochmals erstellt.
- **Nicht getestet, weil bewusst noch nicht aktiviert:** voll authentifizierte Live-Grantausstellung, Server-Secret-Verwahrung, echte Benutzerrollen, Widerruf unter Live-Last und signierter Desktop-Release.

## Weiterhin P0 vor produktivem Verified-Progress

1. Vertrauenswürdige Schlüsselgenerierung und Schlüsselverwahrung, issuer-Public-Key-Pinning in signierter KatoSync-App, dokumentiertes Rotation-/Revocation-Verfahren.
2. Administrative Registrierung des tatsächlich berechtigten Projekts und einer verifizierten Person nach Zustimmung, Prüfung der Schlüsselherkunft; **keine automatische Selbstvergabe**.
3. Live-End-to-End-Test mit echtem KATOOS-SSO, serverseitiger Revocation, kontrollierter Grant-Ausgabe, Signatur, exakter Github-CI-Jobprüfung und Git-Ancestry.
4. Danach ein getrenntes, append-only Accepted-Ledger und read-only Fortschritts-/ETA-Projektion. `verifiedPercent` bleibt bis dahin **null**, keine belastbare Fertigstellungsprognose.
5. M2 Speicherplatz wieder auf mindestens 80 GiB frei bringen, bevor große signierte Release-Builds laufen. Bei letzter QA-Prüfung ca. 44 GiB frei; keine Löschung durchgeführt.

**Prüfprinzip:** Ein deploytes Backend ist kein Beweis einer echten Owner-Freigabe. Der Aussteller bleibt fail-closed, bis der berechtigte Verwaltungsworkflow nachgewiesen und freigegeben wurde.
