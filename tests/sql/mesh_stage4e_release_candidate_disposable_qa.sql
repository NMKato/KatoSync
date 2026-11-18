-- KatoSync Stage4E — fresh *disposable* Postgres 17 Unix-socket-only QA.
-- Never execute these fixtures against actual KatoOS or a network DB.
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

-- The QA-gated candidate refuses the real database. The disposable runner
-- sets its explicit transaction-LOCAL opt-in, never any remote connection.
BEGIN;
SELECT pg_catalog.set_config('katosync.qa_disposable','unix-socket-qa-only',true);
\ir ../../release-candidates/stage4e/qa_only_hardening_candidate.sql
COMMIT;
DO $$
BEGIN
 IF EXISTS(
  SELECT 1 FROM information_schema.columns
   WHERE table_schema='katosync' AND table_name='mesh_owner_policy'
     AND column_name='allowed_devices' AND column_default IS NOT NULL
 ) THEN RAISE EXCEPTION 'RELEASE_QA_IMPLICIT_PAID_POLICY_DEFAULT'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE
   tgrelid='katosync.mesh_devices'::regclass
   AND tgname='katosync_mesh_device_identity_before_update'
   AND NOT tgisinternal)<>1
 THEN RAISE EXCEPTION 'RELEASE_QA_IDENTITY_TRIGGER_MISSING'; END IF;
 IF position('clock_timestamp()' in (SELECT pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='katosync' AND p.proname='mesh_device_quota_guard'))=0
 THEN RAISE EXCEPTION 'RELEASE_QA_WALLCLOCK_EXPIRY_MISSING'; END IF;
END $$;
\echo KATOSYNC_STAGE4E_CANDIDATE_PREFLIGHT_INSTALL_PASS

SET ROLE service_role;
-- Free 0 even before the first policy row exists.
DO $$
DECLARE msg text;
BEGIN
 BEGIN
  INSERT INTO katosync.mesh_devices(
    owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
  VALUES('22222222-2222-4222-8222-222222222222',
         repeat('F',43),repeat('FF-',15)||'FF','FREE0','macos');
  RAISE EXCEPTION 'RELEASE_QA_FREE_INSERT_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'RELEASE_QA_FREE_WRONG_ERROR: %',msg; END IF;
 END;
END $$;
-- A service accidentally omitting allowed_devices must not grant 2 defaults.
DO $$
BEGIN
 BEGIN
  INSERT INTO katosync.mesh_owner_policy(owner_user_id)
    VALUES('22222222-2222-4222-8222-222222222222');
  RAISE EXCEPTION 'RELEASE_QA_POLICY_WITHOUT_EXPLICIT_QUOTA_ACCEPTED';
 EXCEPTION WHEN not_null_violation THEN NULL;
 END;
END $$;
-- Explicit Pro 10 allowance is still server-only and does NOT grant job trust.
INSERT INTO katosync.mesh_owner_policy
 (owner_user_id,allowed_devices,enrollment_mode,policy_expires_at)
VALUES('11111111-1111-4111-8111-111111111111',10,'manual',
       clock_timestamp()+interval '5 minutes');
DO $$
DECLARE i integer; msg text;
BEGIN
 FOR i IN 1..10 LOOP
  INSERT INTO katosync.mesh_devices(
   owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
  VALUES('11111111-1111-4111-8111-111111111111',
         lpad(i::text,43,'Z'),repeat('AB-',15)||upper(lpad(to_hex(i),2,'0')),
         'PRO_'||i,'macos');
 END LOOP;
 IF (SELECT count(*) FROM katosync.mesh_devices
   WHERE owner_user_id='11111111-1111-4111-8111-111111111111')<>10
 THEN RAISE EXCEPTION 'RELEASE_QA_PRO_TEN_NOT_CREATED'; END IF;
 BEGIN
  INSERT INTO katosync.mesh_devices(
   owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
  VALUES('11111111-1111-4111-8111-111111111111',
   repeat('X',43),repeat('EF-',15)||'EF','PRO_11','macos');
  RAISE EXCEPTION 'RELEASE_QA_PRO_ELEVEN_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_DEVICE_QUOTA'
  THEN RAISE EXCEPTION 'RELEASE_QA_PRO_WRONG_ERROR: %',msg; END IF;
 END;
END $$;
-- Attempt owner transfer or replacement of original signed device identity.
DO $$
DECLARE msg text;
BEGIN
 BEGIN
  UPDATE katosync.mesh_devices
   SET owner_user_id='22222222-2222-4222-8222-222222222222'
   WHERE owner_user_id='11111111-1111-4111-8111-111111111111'
     AND display_name='PRO_1';
  RAISE EXCEPTION 'RELEASE_QA_OWNER_TRANSFER_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE'
  THEN RAISE EXCEPTION 'RELEASE_QA_WRONG_UPDATE_ERROR: %',msg; END IF;
 END;
 BEGIN
  UPDATE katosync.mesh_devices SET signing_public_key=repeat('Q',43)
   WHERE display_name='PRO_1';
  RAISE EXCEPTION 'RELEASE_QA_KEY_REPLACEMENT_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE'
  THEN RAISE EXCEPTION 'RELEASE_QA_WRONG_KEY_ERROR: %',msg; END IF;
 END;
 UPDATE katosync.mesh_devices SET display_name='PRO_1_OK',last_seen_at=clock_timestamp()
 WHERE display_name='PRO_1';
 IF (SELECT count(*) FROM katosync.mesh_devices
     WHERE display_name='PRO_1_OK' AND last_seen_at IS NOT NULL)<>1
 THEN RAISE EXCEPTION 'RELEASE_QA_METADATA_UPDATE_FAILED'; END IF;
END $$;
-- Pro/Trial expiration is verified again in the DB trigger, not only Edge.
UPDATE katosync.mesh_owner_policy
 SET policy_expires_at=clock_timestamp()-interval '1 second'
 WHERE owner_user_id='11111111-1111-4111-8111-111111111111';
DO $$
DECLARE msg text;
BEGIN
 BEGIN
  INSERT INTO katosync.mesh_devices(
   owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
  VALUES('11111111-1111-4111-8111-111111111111',
         repeat('T',43),repeat('DD-',15)||'DD','EXPIRED','macos');
  RAISE EXCEPTION 'RELEASE_QA_EXPIRED_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'RELEASE_QA_EXPIRED_WRONG_ERROR: %',msg; END IF;
 END;
END $$;
-- A manually deleted policy also loses all *new* registrations, preserving
-- existing identities as public roster until separate lifecycle review.
DELETE FROM katosync.mesh_owner_policy
 WHERE owner_user_id='11111111-1111-4111-8111-111111111111';
DO $$
DECLARE msg text;
BEGIN
 BEGIN
  INSERT INTO katosync.mesh_devices(
   owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
  VALUES('11111111-1111-4111-8111-111111111111',
         repeat('U',43),repeat('EE-',15)||'EE','REVOKED_POLICY','macos');
  RAISE EXCEPTION 'RELEASE_QA_REVOKED_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'RELEASE_QA_REVOKED_WRONG_ERROR: %',msg; END IF;
 END;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF has_table_privilege('anon','katosync.mesh_devices','INSERT,UPDATE')
 OR has_table_privilege('authenticated','katosync.mesh_devices','INSERT,UPDATE')
 OR has_table_privilege('authenticated','katosync.mesh_owner_policy','INSERT,UPDATE')
 OR has_function_privilege('anon','katosync.mesh_device_identity_immutability_guard()','EXECUTE')
 OR has_function_privilege('authenticated','katosync.mesh_device_identity_immutability_guard()','EXECUTE')
 THEN RAISE EXCEPTION 'RELEASE_QA_CLIENT_ROLE_WRITE_ALLOWED'; END IF;
END $$;
\echo KATOSYNC_STAGE4E_CANDIDATE_FREE0_PRO10_EXPIRY_IMMUTABILITY_PASS

-- Next prove an emergency freeze COMMIT retains the device roster and
-- immutable identity, while denying even otherwise eligible paid inserts.
SET ROLE service_role;
INSERT INTO katosync.mesh_owner_policy
 (owner_user_id,allowed_devices,enrollment_mode,policy_expires_at)
VALUES('33333333-3333-4333-8333-333333333333',10,'manual',NULL);
INSERT INTO katosync.mesh_devices(
 owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
VALUES('33333333-3333-4333-8333-333333333333',
 repeat('L',43),repeat('CD-',15)||'CD','BEFORE_FREEZE','macos');
RESET ROLE;
BEGIN;
SELECT pg_catalog.set_config('katosync.qa_disposable','unix-socket-qa-only',true);
\ir ../../release-candidates/stage4e/qa_only_emergency_freeze.sql
COMMIT;
SET ROLE service_role;
DO $$
DECLARE msg text;
BEGIN
 BEGIN
  INSERT INTO katosync.mesh_devices(
   owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
  VALUES('33333333-3333-4333-8333-333333333333',
     repeat('M',43),repeat('DE-',15)||'DE','AFTER_FREEZE','macos');
  RAISE EXCEPTION 'RELEASE_QA_FREEZE_FAILED_TO_DENY';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENROLLMENT_FROZEN'
  THEN RAISE EXCEPTION 'RELEASE_QA_FREEZE_WRONG_ERROR: %',msg; END IF;
 END;
 IF (SELECT count(*) FROM katosync.mesh_devices
      WHERE owner_user_id='33333333-3333-4333-8333-333333333333')<>1
 THEN RAISE EXCEPTION 'RELEASE_QA_FREEZE_REMOVED_OR_CREATED_DEVICE'; END IF;
 BEGIN
  UPDATE katosync.mesh_devices
  SET owner_user_id='22222222-2222-4222-8222-222222222222'
  WHERE display_name='BEFORE_FREEZE';
  RAISE EXCEPTION 'RELEASE_QA_FREEZE_WEAKENED_IDENTITY';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE'
  THEN RAISE EXCEPTION 'RELEASE_QA_FREEZE_WRONG_IDENTITY: %',msg; END IF;
 END;
 UPDATE katosync.mesh_devices
 SET last_seen_at=clock_timestamp()
 WHERE display_name='BEFORE_FREEZE';
END $$;
RESET ROLE;
\echo KATOSYNC_STAGE4E_CANDIDATE_EMERGENCY_FREEZE_DENIES_NEW_AND_PRESERVES_EXISTING_PASS
