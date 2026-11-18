-- NMKato Solutions / Stage 4E – prepared migration, NOT APPLIED.
-- Preserve advisory transaction lock. Missing/expired policy=zero devices.
CREATE OR REPLACE FUNCTION katosync.mesh_device_quota_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  max_devices integer;
  expiration timestamptz;
  current_devices integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(new.owner_user_id::text)::bigint
  );
  SELECT p.allowed_devices,p.policy_expires_at INTO max_devices,expiration
    FROM katosync.mesh_owner_policy p
   WHERE p.owner_user_id=new.owner_user_id;
  IF max_devices IS NULL OR max_devices < 1 OR max_devices > 10 OR
     (expiration IS NOT NULL AND expiration <= pg_catalog.now()) THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_ENTITLEMENT_REQUIRED' USING errcode='23514';
  END IF;
  SELECT count(*) INTO current_devices
    FROM katosync.mesh_devices WHERE owner_user_id=new.owner_user_id;
  IF current_devices>=max_devices THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_DEVICE_QUOTA' USING errcode='23514';
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION katosync.mesh_device_quota_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_device_quota_guard() TO service_role;
-- Existing before-insert trigger remains installed.
