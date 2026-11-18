-- NMKato Solutions. NONPRODUCTION PostgreSQL 17 / Unix socket ONLY.
-- This is a one-shot disposable cluster test. Never apply to KatoOS.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
INSERT INTO auth.users(id) VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333');
\ir ../../supabase/migrations/20261028202403_katosync_mesh_owned_schema.sql
-- The Stage4E proposal remains inert under tests/fixtures and is installed
-- ONLY in this temporary, TCP-disabled PostgreSQL 17 fixture.
\ir ../fixtures/migrations/20261103162500_mesh_entitlement_expiry_guard.sql

SET ROLE service_role;
DO $$
DECLARE message text; owner_id uuid:='22222222-2222-4222-8222-222222222222';
BEGIN
 BEGIN
  INSERT INTO katosync.mesh_devices
   (owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
   VALUES (owner_id,repeat('F',43),repeat('FF-',15)||'FF','NO_POLICY','macos');
  RAISE EXCEPTION 'QUOTA_QA_FREE_WAS_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED' THEN
   RAISE EXCEPTION 'QUOTA_QA_WRONG_FREE_DENIAL: %',message; END IF;
 END;
 IF (SELECT count(*) FROM katosync.mesh_devices WHERE owner_user_id=owner_id)<>0
 THEN RAISE EXCEPTION 'QUOTA_QA_FREE_INSERTED_DEVICE'; END IF;
END $$;

INSERT INTO katosync.mesh_owner_policy
 (owner_user_id,allowed_devices,enrollment_mode,policy_expires_at)
 VALUES('11111111-1111-4111-8111-111111111111',2,'manual',now()+interval '5 minutes');
INSERT INTO katosync.mesh_devices
 (owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
VALUES
 ('11111111-1111-4111-8111-111111111111',repeat('A',43),repeat('AA-',15)||'AA','ALLOWED_FIRST','macos'),
 ('11111111-1111-4111-8111-111111111111',repeat('B',43),repeat('BB-',15)||'BB','ALLOWED_SECOND','macos');

DO $$
DECLARE message text;
BEGIN
 BEGIN
  INSERT INTO katosync.mesh_devices
   (owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
  VALUES ('11111111-1111-4111-8111-111111111111',
          repeat('C',43),repeat('CC-',15)||'CC','OVER_QUOTA','macos');
  RAISE EXCEPTION 'QUOTA_QA_OVER_QUOTA_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'KATOSYNC_MESH_DEVICE_QUOTA' THEN
   RAISE EXCEPTION 'QUOTA_QA_WRONG_OVERQUOTA_DENIAL: %',message; END IF;
 END;
END $$;

UPDATE katosync.mesh_owner_policy SET policy_expires_at=now()-interval '1 second'
 WHERE owner_user_id='11111111-1111-4111-8111-111111111111';
DO $$
DECLARE message text;
BEGIN
 BEGIN
  INSERT INTO katosync.mesh_devices
   (owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
  VALUES ('11111111-1111-4111-8111-111111111111',
          repeat('D',43),repeat('DD-',15)||'DD','EXPIRED','macos');
  RAISE EXCEPTION 'QUOTA_QA_EXPIRED_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED' THEN
   RAISE EXCEPTION 'QUOTA_QA_WRONG_EXPIRED_DENIAL: %',message; END IF;
 END;
END $$;

-- Replacing an active policy by nothing must restore Free=0 without deleting
-- public device identities or granting a new device.
DELETE FROM katosync.mesh_owner_policy
 WHERE owner_user_id='11111111-1111-4111-8111-111111111111';
DO $$
DECLARE message text;
BEGIN
 BEGIN
  INSERT INTO katosync.mesh_devices
   (owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
  VALUES ('11111111-1111-4111-8111-111111111111',
          repeat('E',43),repeat('EE-',15)||'EE','REVOKED_POLICY','macos');
  RAISE EXCEPTION 'QUOTA_QA_REMOVED_POLICY_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED' THEN
   RAISE EXCEPTION 'QUOTA_QA_WRONG_REVOKED_DENIAL: %',message; END IF;
 END;
END $$;

-- Pro cap: 10 distinct discovered device identities maximum (NOT 10 peers,
-- not permission to execute jobs); only server-managed policy authorizes it.
INSERT INTO katosync.mesh_owner_policy
 (owner_user_id,allowed_devices,enrollment_mode,policy_expires_at)
 VALUES('33333333-3333-4333-8333-333333333333',10,'manual',NULL);
DO $$
DECLARE i integer; message text;
BEGIN
 FOR i IN 1..10 LOOP
  INSERT INTO katosync.mesh_devices
   (owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
  VALUES('33333333-3333-4333-8333-333333333333',
         lpad(i::text,43,'Z'),repeat('AB-',15)||upper(lpad(to_hex(i),2,'0')),
         'PRO_'||i,'macos');
 END LOOP;
 IF (SELECT count(*) FROM katosync.mesh_devices
     WHERE owner_user_id='33333333-3333-4333-8333-333333333333')<>10
 THEN RAISE EXCEPTION 'QUOTA_QA_PRO_TEN_INCOMPLETE'; END IF;
 BEGIN
  INSERT INTO katosync.mesh_devices
   (owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
  VALUES('33333333-3333-4333-8333-333333333333',
         repeat('T',43),repeat('AD-',15)||'AD','PRO_11','macos');
  RAISE EXCEPTION 'QUOTA_QA_PRO_ELEVEN_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'KATOSYNC_MESH_DEVICE_QUOTA' THEN
   RAISE EXCEPTION 'QUOTA_QA_WRONG_PRO_DENIAL: %',message; END IF;
 END;
END $$;
RESET ROLE;
-- No direct authenticated mutation access even when 10-device policy exists.
DO $$
BEGIN
 IF has_table_privilege('anon','katosync.mesh_devices','INSERT')
    OR has_table_privilege('authenticated','katosync.mesh_devices','INSERT')
    OR has_function_privilege('authenticated','katosync.mesh_device_quota_guard()','EXECUTE')
 THEN RAISE EXCEPTION 'QUOTA_QA_PUBLIC_EXECUTION_RIGHTS'; END IF;
END $$;
\echo KATOSYNC_STAGE4E_DISPOSABLE_QUOTA_FREE0_PRO10_EXPIRY_DENY_PASS
