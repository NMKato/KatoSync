-- Created by NMKato Solutions
-- Disposable PostgreSQL fixture only. Not a production SQL migration.
\set ON_ERROR_STOP on

-- Model Supabase's relevant server APIs/roles, not the entire platform.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;
CREATE SCHEMA realtime;
CREATE TABLE realtime.messages(topic text, extension text);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT current_setting('request.jwt.claim.mesh_topic', true)
  $$;
GRANT USAGE ON SCHEMA auth,realtime,public TO anon,authenticated,service_role;
GRANT SELECT, INSERT ON realtime.messages TO authenticated;
INSERT INTO auth.users(id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

-- Execute exactly the repository's three pending staged migrations, with
-- no remote connections or live schema modifications.
\ir ../../supabase/migrations/20261027153306_mesh_device_registry_fail_closed.sql
\ir ../../supabase/migrations/20261028081746_mesh_device_enrollment_challenge.sql
\ir ../../supabase/migrations/20261028115220_mesh_owner_private_realtime_signaling.sql

-- Seed only synthetic public credentials, isolated to the throwaway cluster.
INSERT INTO public.katosync_mesh_owner_policy(owner_user_id, allowed_devices)
VALUES ('11111111-1111-4111-8111-111111111111',2);
INSERT INTO public.katosync_mesh_devices
  (owner_user_id, signing_public_key, fingerprint, display_name,platform_os,enrolled_at)
VALUES
  ('11111111-1111-4111-8111-111111111111',
    repeat('A',43), repeat('AA-',15)||'AA', 'fixture M2', 'macos', now()),
  ('11111111-1111-4111-8111-111111111111',
    repeat('B',43), repeat('BB-',15)||'BB', 'fixture M3', 'macos', now()),
  ('22222222-2222-4222-8222-222222222222',
    repeat('C',43), repeat('CC-',15)||'CC', 'other owner', 'windows',now());
INSERT INTO public.katosync_mesh_invites
  (owner_user_id,source_device_id,target_device_id,nonce,signed_offer,expires_at)
SELECT '11111111-1111-4111-8111-111111111111',
       (array_agg(device_id ORDER BY device_id))[1],
       (array_agg(device_id ORDER BY device_id))[2],
       repeat('D',43),'{}'::jsonb, now()+interval '3 minutes'
FROM public.katosync_mesh_devices
WHERE owner_user_id='11111111-1111-4111-8111-111111111111';

-- Verify structure really requires RLS and strips client DML privileges.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'katosync_mesh_devices','katosync_mesh_owner_policy',
    'katosync_mesh_invites','katosync_mesh_enrollment_challenges'
  ] LOOP
    IF NOT EXISTS(
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
      WHERE ns.nspname='public' AND c.relname=t AND c.relrowsecurity
    ) THEN RAISE EXCEPTION 'MESH_QA_NO_RLS: %',t; END IF;
    IF pg_catalog.has_table_privilege('authenticated','public.'||t,'INSERT')
       OR pg_catalog.has_table_privilege('authenticated','public.'||t,'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated','public.'||t,'DELETE')
       OR pg_catalog.has_table_privilege('anon','public.'||t,'SELECT')
    THEN RAISE EXCEPTION 'MESH_QA_EXPOSED_DML: %',t; END IF;
  END LOOP;
END $$;

-- Simulate a client with the first owner JWT: other owner's devices hidden.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('request.jwt.claims','{"is_anonymous":false}',false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.katosync_mesh_devices) <> 2
  OR (SELECT count(*) FROM public.katosync_mesh_owner_policy) <> 1
  OR (SELECT count(*) FROM public.katosync_mesh_invites) <> 1
  THEN RAISE EXCEPTION 'MESH_QA_OWNER_RLS_NOT_PRIVATE'; END IF;

  BEGIN
    INSERT INTO public.katosync_mesh_devices
    (owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
    VALUES('11111111-1111-4111-8111-111111111111',
      repeat('E',43),repeat('EE-',15)||'EE','BAD','macos');
    RAISE EXCEPTION 'MESH_QA_CLIENT_WRITER_OPEN';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.katosync_mesh_enrollment_challenges
    (owner_user_id,signing_public_key,nonce,expires_at)
    VALUES('11111111-1111-4111-8111-111111111111',
      repeat('E',43),repeat('E',43),now()+interval '90 seconds');
    RAISE EXCEPTION 'MESH_QA_CLIENT_CHALLENGE_WRITER_OPEN';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
-- Check role change / ownership isolation: the first owner's devices disappear.
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.katosync_mesh_devices) <> 1
  OR (SELECT count(*) FROM public.katosync_mesh_owner_policy) <> 0
  OR (SELECT count(*) FROM public.katosync_mesh_invites) <> 0
  THEN RAISE EXCEPTION 'MESH_QA_CROSS_OWNER_LEAK'; END IF;
END $$;
-- A request without a verified user principal must never see records.
SELECT set_config('request.jwt.claim.sub','',false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.katosync_mesh_devices) <> 0
  OR (SELECT count(*) FROM public.katosync_mesh_invites) <> 0
  THEN RAISE EXCEPTION 'MESH_QA_MISSING_JWT_OWNER_LEAK'; END IF;
END $$;
RESET ROLE;

-- The server-side quota trigger is the final authority, including concurrent
-- requests. A third different key for the free-plan owner must be rejected.
SET ROLE service_role;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.katosync_mesh_devices
    (owner_user_id, signing_public_key, fingerprint, display_name,platform_os,enrolled_at)
    VALUES('11111111-1111-4111-8111-111111111111',
      repeat('E',43),repeat('EE-',15)||'EE','overflow','macos',now());
    RAISE EXCEPTION 'MESH_QA_QUOTA_NOT_ENFORCED';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END $$;

-- Challenge budget is owner-scoped. This exercises the actual trigger, not
-- the Edge Function's optional preflight count.
INSERT INTO public.katosync_mesh_enrollment_challenges
(owner_user_id,signing_public_key,nonce,expires_at)
VALUES
('11111111-1111-4111-8111-111111111111',repeat('A',43),repeat('F',43),now()+interval '90 seconds'),
('11111111-1111-4111-8111-111111111111',repeat('A',43),repeat('G',43),now()+interval '90 seconds'),
('11111111-1111-4111-8111-111111111111',repeat('A',43),repeat('H',43),now()+interval '90 seconds');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.katosync_mesh_enrollment_challenges
    (owner_user_id,signing_public_key,nonce,expires_at)
    VALUES ('11111111-1111-4111-8111-111111111111',
      repeat('A',43),repeat('I',43),now()+interval '90 seconds');
    RAISE EXCEPTION 'MESH_QA_CHALLENGE_RATE_OPEN';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END $$;
RESET ROLE;

-- Realtime topic policies are owner-scoped; a broadcast cannot be re-labelled
-- to another account, and a purported anonymous identity must fail.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('request.jwt.claims','{"is_anonymous":false}',false);
SELECT set_config('request.jwt.claim.mesh_topic',
  'katosync-mesh-owner:v1:11111111-1111-4111-8111-111111111111',false);
INSERT INTO realtime.messages(topic,extension)
VALUES ('katosync-mesh-owner:v1:11111111-1111-4111-8111-111111111111','broadcast');
SELECT set_config('request.jwt.claim.mesh_topic',
  'katosync-mesh-owner:v1:22222222-2222-4222-8222-222222222222',false);
DO $$
BEGIN
  BEGIN
    INSERT INTO realtime.messages(topic,extension)
    VALUES ('katosync-mesh-owner:v1:22222222-2222-4222-8222-222222222222','broadcast');
    RAISE EXCEPTION 'MESH_QA_FOREIGN_REALTIME_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claim.mesh_topic',
  'katosync-mesh-owner:v1:11111111-1111-4111-8111-111111111111',false);
SELECT set_config('request.jwt.claims','{"is_anonymous":true}',false);
DO $$
BEGIN
  BEGIN
    INSERT INTO realtime.messages(topic,extension)
    VALUES ('katosync-mesh-owner:v1:11111111-1111-4111-8111-111111111111','broadcast');
    RAISE EXCEPTION 'MESH_QA_ANON_REALTIME_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
\echo MESH_QA_POSTGRES_RLS_AND_TRIGGER_NEGATIVE_CASES_PASS
