-- NMKato Solutions — KatoSync Stage4E: QA RELEASE CANDIDATE, NOT A MIGRATION.
-- DO NOT COPY TO supabase/migrations. DO NOT RUN AGAINST LIVE KATOOS.
-- Prepared for independent human review and creation of a NEW migration.
-- Requires a disposable Postgres 17 Unix socket and explicit transaction-local QA gate.
-- Does not assign any plan, reviewer, device trust, Mesh job or billing right.

DO $qa$
BEGIN
  IF pg_catalog.current_setting('katosync.qa_disposable', true)
      IS DISTINCT FROM 'unix-socket-qa-only'
     OR pg_catalog.inet_server_addr() IS NOT NULL
  THEN RAISE EXCEPTION 'KATOSYNC_STAGE4E_QA_ONLY_REFUSED' USING ERRCODE='42501';
  END IF;
  IF pg_catalog.current_setting('server_version_num')::integer < 170000
  THEN RAISE EXCEPTION 'KATOSYNC_STAGE4E_REQUIRES_POSTGRES_17';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid='katosync.mesh_devices'::pg_catalog.regclass
      AND relrowsecurity
  ) OR NOT EXISTS(
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid='katosync.mesh_owner_policy'::pg_catalog.regclass
      AND relrowsecurity
  ) THEN RAISE EXCEPTION 'KATOSYNC_STAGE4E_RLS_PREFLIGHT_FAILED';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='katosync.mesh_devices'::pg_catalog.regclass
      AND tgname='katosync_mesh_device_quota_before_insert'
      AND NOT tgisinternal AND tgenabled='O'
  ) OR EXISTS(
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='katosync.mesh_devices'::pg_catalog.regclass
      AND tgname='katosync_mesh_device_identity_before_update'
  ) THEN RAISE EXCEPTION 'KATOSYNC_STAGE4E_TRIGGER_PREFLIGHT_FAILED';
  END IF;
  IF pg_catalog.has_table_privilege('anon','katosync.mesh_devices','INSERT,UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','katosync.mesh_devices','INSERT,UPDATE')
     OR pg_catalog.has_table_privilege('anon','katosync.mesh_owner_policy','INSERT,UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','katosync.mesh_owner_policy','INSERT,UPDATE')
  THEN RAISE EXCEPTION 'KATOSYNC_STAGE4E_DML_PREFLIGHT_FAILED';
  END IF;
END $qa$;

-- Explicit trusted service-role policy provisioning only. Never silently
-- manufacture a paid allowance with the historical DEFAULT 2.
ALTER TABLE katosync.mesh_owner_policy ALTER COLUMN allowed_devices DROP DEFAULT;

-- Preserve per-owner transaction serialization, additionally lock the policy row
-- so concurrent revoke/downgrade/expiry updates cannot race an insertion.
-- The physical timestamp matters: now() can be stale in a long transaction.
CREATE OR REPLACE FUNCTION katosync.mesh_device_quota_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $quota$
DECLARE
  max_devices integer;
  expiry timestamptz;
  used_devices integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(NEW.owner_user_id::text)::bigint
  );
  SELECT p.allowed_devices,p.policy_expires_at
    INTO max_devices,expiry
  FROM katosync.mesh_owner_policy p
  WHERE p.owner_user_id=NEW.owner_user_id
  FOR SHARE;
  IF max_devices IS NULL OR max_devices < 1 OR max_devices > 10
     OR (expiry IS NOT NULL AND expiry<=pg_catalog.clock_timestamp())
  THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_ENTITLEMENT_REQUIRED' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO used_devices
  FROM katosync.mesh_devices
  WHERE owner_user_id=NEW.owner_user_id;
  -- All identities, including revoked ones, consume registry slots until
  -- a separately approved lifecycle policy says otherwise.
  IF used_devices>=max_devices THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_DEVICE_QUOTA' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $quota$;
REVOKE ALL ON FUNCTION katosync.mesh_device_quota_guard()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_device_quota_guard() TO service_role;

-- A BEFORE INSERT-only quota trigger cannot protect UPDATE owner transfers.
-- Never allow an existing signed public identity to be re-bound in place.
CREATE FUNCTION katosync.mesh_device_identity_immutability_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $immutable$
BEGIN
  IF NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.signing_public_key IS DISTINCT FROM OLD.signing_public_key
     OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
  THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $immutable$;
REVOKE ALL ON FUNCTION katosync.mesh_device_identity_immutability_guard()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_device_identity_immutability_guard()
  TO service_role;
CREATE TRIGGER katosync_mesh_device_identity_before_update
  BEFORE UPDATE ON katosync.mesh_devices
  FOR EACH ROW EXECUTE FUNCTION katosync.mesh_device_identity_immutability_guard();

-- This candidate does not alter any existing owner policy, registered device,
-- billing record, reviewer role, Mesh invitation or remote-execution policy.
