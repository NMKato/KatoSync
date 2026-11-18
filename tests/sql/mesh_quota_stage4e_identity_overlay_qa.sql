-- NMKato Solutions — QA ONLY / NOT A PRODUCTION MIGRATION.
-- Supplement to the immutable Stage4E quota fixture. Run in disposable PG only.
-- A service role may update mutable discovery metadata, but cannot transfer
-- an already enrolled device identity to another account or public key.
CREATE OR REPLACE FUNCTION katosync.mesh_device_identity_immutability_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.signing_public_key IS DISTINCT FROM OLD.signing_public_key
     OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE'
      USING errcode='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION katosync.mesh_device_identity_immutability_guard()
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_device_identity_immutability_guard()
 TO service_role;
CREATE TRIGGER katosync_mesh_device_identity_before_update
 BEFORE UPDATE ON katosync.mesh_devices
 FOR EACH ROW EXECUTE FUNCTION katosync.mesh_device_identity_immutability_guard();
