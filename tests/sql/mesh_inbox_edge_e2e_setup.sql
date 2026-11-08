-- NMKato Solutions -- disposable PostgreSQL 17, Unix socket only.
-- This file is NEVER for a live Supabase project.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111');
\ir ../../supabase/migrations/20261028202403_katosync_mesh_owned_schema.sql
\ir ../../supabase/migrations/20261029211243_mesh_inbox_signed_send_guard.sql
\ir ../../supabase/migrations/20261030072543_mesh_recipient_signed_inbox_atomic_decisions.sql
\ir ../../supabase/migrations/20261030074910_mesh_resolution_proof_binding.sql
\ir ../../supabase/migrations/20261030093323_mesh_inbox_recipient_key_continuity.sql
DO $$
BEGIN
 IF has_table_privilege('authenticated','katosync.mesh_invites','SELECT')
 OR has_table_privilege('authenticated','katosync.mesh_invites','UPDATE')
 OR has_table_privilege('authenticated','katosync.mesh_inbox_proofs','INSERT')
 OR NOT has_table_privilege('service_role','katosync.mesh_invites','UPDATE')
 THEN RAISE EXCEPTION 'MESH_E2E_NOT_ISOLATED_OR_WRONG_ROLES'; END IF;
END $$;
\echo MESH_LOCAL_E2E_SCHEMA_READY
