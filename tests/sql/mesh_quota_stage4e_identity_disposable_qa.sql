-- NMKato Solutions — disposable PostgreSQL 17 / Unix socket ONLY.
-- Prove the old insert-only guard cannot protect UPDATE reassignment,
-- then test a QA-only, transactionally rolled-back identity guard overlay.
\set ON_ERROR_STOP on
\ir mesh_quota_stage4e_disposable_qa.sql

-- Baseline negative observation (never production): old trigger is INSERT-only.
BEGIN;
SET ROLE service_role;
UPDATE katosync.mesh_devices
   SET owner_user_id='22222222-2222-4222-8222-222222222222'
 WHERE owner_user_id='33333333-3333-4333-8333-333333333333'
   AND display_name='PRO_1';
DO $$
BEGIN
 IF (SELECT count(*) FROM katosync.mesh_devices
     WHERE owner_user_id='22222222-2222-4222-8222-222222222222'
       AND display_name='PRO_1')<>1 THEN
  RAISE EXCEPTION 'IDENTITY_QA_BASELINE_REASSIGN_NOT_REPRODUCED';
 END IF;
END $$;
ROLLBACK;
\echo KATOSYNC_STAGE4E_DISPOSABLE_INSERT_ONLY_TRANSFER_GAP_REPRODUCED

-- The hardening overlay exists *only* inside this disposable transaction.
BEGIN;
\ir mesh_quota_stage4e_identity_overlay_qa.sql
SET ROLE service_role;
DO $$
DECLARE message text; owner_id uuid:='33333333-3333-4333-8333-333333333333';
BEGIN
 BEGIN
  UPDATE katosync.mesh_devices
     SET owner_user_id='22222222-2222-4222-8222-222222222222'
   WHERE owner_user_id=owner_id AND display_name='PRO_1';
  RAISE EXCEPTION 'IDENTITY_QA_OWNER_TRANSFER_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE' THEN
   RAISE EXCEPTION 'IDENTITY_QA_TRANSFER_WRONG_DENIAL: %',message;
  END IF;
 END;
 BEGIN
  UPDATE katosync.mesh_devices SET signing_public_key=repeat('Q',43)
   WHERE owner_user_id=owner_id AND display_name='PRO_1';
  RAISE EXCEPTION 'IDENTITY_QA_KEY_ROTATION_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE' THEN
   RAISE EXCEPTION 'IDENTITY_QA_KEY_WRONG_DENIAL: %',message;
  END IF;
 END;
 BEGIN
  UPDATE katosync.mesh_devices
     SET fingerprint=repeat('00-',15)||'00'
   WHERE owner_user_id=owner_id AND display_name='PRO_1';
  RAISE EXCEPTION 'IDENTITY_QA_FINGERPRINT_MUTATION_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE' THEN
   RAISE EXCEPTION 'IDENTITY_QA_FINGERPRINT_WRONG_DENIAL: %',message;
  END IF;
 END;
 BEGIN
  UPDATE katosync.mesh_devices SET device_id=gen_random_uuid()
   WHERE owner_user_id=owner_id AND display_name='PRO_1';
  RAISE EXCEPTION 'IDENTITY_QA_DEVICE_ID_MUTATION_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE' THEN
   RAISE EXCEPTION 'IDENTITY_QA_DEVICE_ID_WRONG_DENIAL: %',message;
  END IF;
 END;

 -- Routine status/presence metadata remains updatable by the trusted service.
 UPDATE katosync.mesh_devices
   SET display_name='QA_MUTABLE_METADATA_OK',
       membership_state='pending',last_seen_at=now()
 WHERE owner_user_id=owner_id AND display_name='PRO_1';
 IF (SELECT count(*) FROM katosync.mesh_devices
      WHERE owner_user_id=owner_id AND display_name='QA_MUTABLE_METADATA_OK'
        AND membership_state='pending' AND last_seen_at IS NOT NULL)<>1
 THEN RAISE EXCEPTION 'IDENTITY_QA_SAFE_METADATA_UPDATE_DENIED'; END IF;
 IF (SELECT count(*) FROM katosync.mesh_devices
      WHERE owner_user_id=owner_id)<>10
 THEN RAISE EXCEPTION 'IDENTITY_QA_QUOTA_COUNT_CHANGED'; END IF;
END $$;
RESET ROLE;

-- RLS + privilege gates remain intact even when service-only UPDATE is allowed.
DO $$
BEGIN
 IF has_table_privilege('anon','katosync.mesh_devices','UPDATE')
 OR has_table_privilege('authenticated','katosync.mesh_devices','UPDATE')
 OR has_function_privilege('anon',
     'katosync.mesh_device_identity_immutability_guard()','EXECUTE')
 OR has_function_privilege('authenticated',
     'katosync.mesh_device_identity_immutability_guard()','EXECUTE')
 THEN RAISE EXCEPTION 'IDENTITY_QA_PUBLIC_MUTATION_OR_EXECUTE'; END IF;
END $$;
\echo KATOSYNC_STAGE4E_DISPOSABLE_IMMUTABLE_OWNER_KEY_FINGERPRINT_ID_PASS
ROLLBACK;

-- Rollback proof: original disposable function and rows remain unchanged,
-- and the new overlay leaves no lasting trigger/function objects.
DO $$
BEGIN
 IF to_regprocedure('katosync.mesh_device_identity_immutability_guard()') IS NOT NULL
 OR EXISTS(
   SELECT 1 FROM pg_trigger
    WHERE tgrelid='katosync.mesh_devices'::regclass
      AND tgname='katosync_mesh_device_identity_before_update'
 ) THEN RAISE EXCEPTION 'IDENTITY_QA_ROLLBACK_DID_NOT_REMOVE_OVERLAY'; END IF;
 IF (SELECT count(*) FROM katosync.mesh_devices
     WHERE owner_user_id='33333333-3333-4333-8333-333333333333')<>10
 THEN RAISE EXCEPTION 'IDENTITY_QA_ROLLBACK_CHANGED_QUOTA'; END IF;
 IF (SELECT count(*) FROM katosync.mesh_devices
     WHERE display_name='PRO_1' AND membership_state='discovered')<>1
 THEN RAISE EXCEPTION 'IDENTITY_QA_ROLLBACK_CHANGED_DEVICE'; END IF;
END $$;
\echo KATOSYNC_STAGE4E_DISPOSABLE_HARDENING_ROLLBACK_PASS
