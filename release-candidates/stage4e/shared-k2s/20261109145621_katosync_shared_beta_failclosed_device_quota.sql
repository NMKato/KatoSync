-- NMKato Solutions — KatoSync PRIVATE BETA fail-closed device enrollment.
-- K2S shared project, katosync namespace ONLY. No new Supabase project.
-- No customer-data mutation, no plan grants and no remote-job activation.
-- This is a REVIEW CANDIDATE. Do not apply to K2S until a confirmed
-- restore point, preflight and explicit deployment sign-off are recorded.
--
-- This migration converts historical implicit 2-device fallback into a
-- required server-provisioned policy + active KatoSync membership.
-- Existing devices and explicit 10-device private owner policy are retained.

DO $preflight$
DECLARE quota_oid oid;
BEGIN
 IF pg_catalog.current_setting('server_version_num')::int < 170000
 THEN RAISE EXCEPTION 'KATOSYNC_SELF_BETA_REQUIRES_PG17'; END IF;
 IF pg_catalog.to_regclass('katosync.mesh_devices') IS NULL
    OR pg_catalog.to_regclass('katosync.mesh_owner_policy') IS NULL
    OR pg_catalog.to_regclass('katosync.account_memberships') IS NULL
 THEN RAISE EXCEPTION 'KATOSYNC_SELF_BETA_MISSING_BASE_SCHEMA'; END IF;
 SELECT p.oid INTO quota_oid
 FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='katosync' AND p.proname='mesh_device_quota_guard'
   AND p.pronargs=0;
 IF quota_oid IS NULL OR
    pg_catalog.strpos(
      pg_catalog.upper(pg_catalog.pg_get_functiondef(quota_oid)),
      'COALESCE')=0
 THEN RAISE EXCEPTION 'KATOSYNC_SELF_BETA_UNEXPECTED_EXISTING_QUOTA_GUARD';
 END IF;
 IF EXISTS (
  SELECT 1 FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid='katosync.mesh_devices'::regclass
   AND t.tgname='katosync_mesh_device_identity_before_update'
 ) THEN RAISE EXCEPTION 'KATOSYNC_SELF_BETA_IDENTITY_TRIGGER_ALREADY_PRESENT';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid='katosync.mesh_devices'::regclass
   AND t.tgname='katosync_mesh_device_quota_before_insert'
   AND t.tgenabled='O' AND NOT t.tgisinternal
 ) THEN RAISE EXCEPTION 'KATOSYNC_SELF_BETA_REQUIRED_QUOTA_TRIGGER_MISSING';
 END IF;
 IF pg_catalog.has_table_privilege('anon','katosync.mesh_devices','INSERT')
 OR pg_catalog.has_table_privilege('authenticated','katosync.mesh_devices','INSERT')
 OR pg_catalog.has_table_privilege('anon','katosync.mesh_owner_policy','INSERT')
 OR pg_catalog.has_table_privilege('authenticated','katosync.mesh_owner_policy','INSERT')
 THEN RAISE EXCEPTION 'KATOSYNC_SELF_BETA_CLIENT_WRITES_NOT_ISOLATED'; END IF;
END $preflight$;

-- Never manufacture a private Pro grant by omitting a policy field.
ALTER TABLE katosync.mesh_owner_policy
 ALTER COLUMN allowed_devices DROP DEFAULT;

CREATE OR REPLACE FUNCTION katosync.mesh_device_quota_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $quota$
DECLARE max_devices integer;
DECLARE expiry timestamptz;
DECLARE member_active boolean;
DECLARE used_devices integer;
BEGIN
 IF current_user<>'service_role'
 THEN RAISE EXCEPTION 'KATOSYNC_MESH_SERVICE_ROLE_REQUIRED'
    USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtext(NEW.owner_user_id::text)::bigint);
 SELECT p.allowed_devices,p.policy_expires_at
 INTO max_devices,expiry
 FROM katosync.mesh_owner_policy p
 WHERE p.owner_user_id=NEW.owner_user_id FOR SHARE;
 IF max_devices IS NULL OR max_devices<1 OR max_devices>10
    OR (expiry IS NOT NULL AND expiry<=pg_catalog.clock_timestamp())
 THEN RAISE EXCEPTION 'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
    USING ERRCODE='23514'; END IF;
 -- Account membership is also server-controlled; a Supabase login alone
 -- must never authorize KatoSync Mesh enrollment.
 SELECT true INTO member_active
 FROM katosync.account_memberships m
 WHERE m.user_id=NEW.owner_user_id
   AND m.access_state='active' AND m.authorized_at IS NOT NULL
   AND m.revoked_at IS NULL
 FOR SHARE;
 IF member_active IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'KATOSYNC_MESH_ACTIVE_MEMBERSHIP_REQUIRED'
    USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO used_devices
 FROM katosync.mesh_devices d
 WHERE d.owner_user_id=NEW.owner_user_id;
 -- Revoked and discovered identities still consume quota until the
 -- independently reviewed cleanup lifecycle explicitly releases slots.
 IF used_devices>=max_devices
 THEN RAISE EXCEPTION 'KATOSYNC_MESH_DEVICE_QUOTA'
    USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $quota$;
REVOKE ALL ON FUNCTION katosync.mesh_device_quota_guard()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_device_quota_guard()
 TO service_role;

CREATE FUNCTION katosync.mesh_device_identity_immutability_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $identity$
BEGIN
 IF NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.signing_public_key IS DISTINCT FROM OLD.signing_public_key
    OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
 THEN RAISE EXCEPTION 'KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE'
   USING ERRCODE='23514'; END IF;
 IF OLD.membership_state='revoked'
    AND NEW.membership_state IS DISTINCT FROM 'revoked'
 THEN RAISE EXCEPTION 'KATOSYNC_MESH_REVOKED_DEVICE_CANNOT_RESURRECT'
   USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $identity$;
REVOKE ALL ON FUNCTION katosync.mesh_device_identity_immutability_guard()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_device_identity_immutability_guard()
 TO service_role;
CREATE TRIGGER katosync_mesh_device_identity_before_update
 BEFORE UPDATE ON katosync.mesh_devices FOR EACH ROW
 EXECUTE FUNCTION katosync.mesh_device_identity_immutability_guard();

-- No changes to any existing KATOOS tables, signed recipient proofs,
-- Auth users, device counts, membership grants or paid plan data.
