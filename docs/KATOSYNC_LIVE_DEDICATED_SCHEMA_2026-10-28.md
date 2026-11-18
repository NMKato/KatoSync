# KatoSync – eigenes Datenbankschema eingerichtet (28.10.2026)

## Architektur und präzise Isolation

Supabase-Projekt: `xbnnlyyxiilklsygxcof` (KATOOS-Projekt).
Neues eigenes Namespace: **`katosync`**.

WICHTIG: Eigenes SQL-Schema ist **keine eigene physische Datenbank** und
**keine eigene Auth-Instanz**. KatoSync nutzt die bereits konfigurierten
Supabase-Auth-Endpunkte desselben Projekts, und Fremdschlüssel zeigen
auf `auth.users`. KATOOS-CMS-Tabellen werden weder verändert noch in
KatoSync-Datenbankabfragen verwendet. Die Isolation ist durch Schema-
Rechte, RLS und die Konto-ID `auth.uid()` realisiert.

## Live angewendet und verifiziert

1. Neue Migration `20261028202403_katosync_mesh_owned_schema.sql`
   erstellt `katosync.mesh_devices`, `katosync.mesh_owner_policy`,
   `katosync.mesh_invites` und
   `katosync.mesh_enrollment_challenges` samt Indizes,
   Foreign Keys und Quota-/Challenge-Triggern.
2. **Alle vier Tabellen haben RLS**; Owner-only SELECT ist ausschließlich
   für `authenticated` bei den ersten drei Tabellen erlaubt.
   `mesh_enrollment_challenges` ist vollständig server-only (RLS
   ohne Client-Policies). Das ist beabsichtigt, kein offenes RLS-Gate.
3. `anon` hat kein `USAGE` auf Schema `katosync`, kein SELECT auf
   Mesh-Tabellen. `authenticated` erhält ausdrücklich **kein**
   INSERT/UPDATE/DELETE; Enrollment schreibt nur mit serverseitigem
   `service_role` nach Auth-/Key-Proof-Prüfung.
4. Alle Tabellen leer bei der Live-Abnahme: 0 Geräte, 0 Policies,
   0 Invites, 0 Challenges. Keine echten User oder Geräte mutiert.
5. Bestehende PostgREST-Schemas blieben unverändert und wurden
   ergänzt: `public, graphql_public, katoos_cms, agent_profile, katosync`.
   Der neue Schema-Cache wurde neu geladen.
6. Negativtest gegen die **echte REST-API** mit `Accept-Profile:
   katosync` und öffentlichem anon-JWT: **HTTP 401 / PostgreSQL 42501,
   permission denied for schema katosync**. Vor Cache-Reload
   kam PGRST205; Cache wurde erfolgreich geladen. Kein Token
   eines echten Nutzers verwendet.
7. M2-Hermetiktest `npm run test:katosync-schema-local`: drei
   vererbte Registry-/Enrollment-Bausteine in eigenem Schema,
   RLS, Owner-Isolation, Quotas und Challenge-Limits erfolgreich;
   lokaler PostgreSQL-Cluster anschließend gelöscht.

## Anwendungspfad angepasst

- KatoSync Desktop:
  `mesh_directory.rs` und `mesh_enrollment_gate.rs` lesen nur
  `/rest/v1/mesh_devices` mit `Accept-Profile: katosync`.
- Edge-Funktion `mesh-device-enrollment`: verwendet die
  Tabellennamen ohne altes `katosync_mesh_`-Präfix und setzt bei
  GET `Accept-Profile: katosync`, bei POST/PATCH
  `Content-Profile: katosync`.
- Keine UI, Schlüsselbund-Identitäten, installierte Apps oder
  produktiven Remote-Verbindungen verändert.

## Ausdrücklich noch nicht freigegeben

Die `mesh-device-enrollment` Edge Function wurde in diesem Schritt
**nicht deployed oder auf Registrierung gestellt**. Live geprüft ist
das SQL-Schema einschließlich anonymer Negativprobe, **nicht**
eine echte KATOOS-Konto-/Geräte-End-to-End-Einschreibung.

Die älteren Entwürfe zur Erstellung von `public.katosync_mesh_*` und
zur Änderung der gemeinsamen `realtime.messages`-Policies wurden
aus `supabase/migrations` in `supabase/staged-migrations`
verschoben. Die historischen QA-Harnesses verwenden weiterhin diese
archivierten Dateien; **reguläre Supabase-Migrationen** enthalten jetzt
nur die beiden live angewendeten dedizierten KatoSync-Schritte.
Vor späterem `supabase db push` immer den Migrationsplan prüfen.

Bei Bedarf PostgREST-Exposure über Supabase Dashboard >
Project Settings > Data API > Exposed schemas prüfen.
Der SQL-Rollback für die ausschließlich ergänzte API-Exposition:
`ALTER ROLE authenticator SET pgrst.db_schemas =
'public, graphql_public, katoos_cms, agent_profile';`
anschließend `NOTIFY pgrst, 'reload config';` und
`NOTIFY pgrst, 'reload schema';`. **Nur bei geplantem Rollback**;
keine anderen KATOOS-Exposed-Schemas entfernen.

Nächste Schritte: Edge Function im Fail-Closed-Modus bereitstellen,
RLS mit gültigem KatoSync-Testkonto verifizieren, serverseitige
Ed25519-Challenge/Response testen, SAS auf M2 und M3 bestätigen,
Widerruf/Logout prüfen. Erst dann kann echter Mesh-Transport
schrittweise aktiviert werden.
