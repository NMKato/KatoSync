-- NMKato Solutions — QA ONLY emergency safety freeze, NOT a rollback to old code.
-- DO NOT RUN against live database. This intentionally denies ALL new Mesh
-- discoveries, including Pro/Trial, while preserving existing device identities,
-- the immutable UPDATE trigger and owner-scoped RLS. Requires human release review.

DO $qa$
BEGIN
  IF pg_catalog.current_setting('katosync.qa_disposable',true)
       IS DISTINCT FROM 'unix-socket-qa-only'
     OR pg_catalog.inet_server_addr() IS NOT NULL
  THEN RAISE EXCEPTION 'KATOSYNC_STAGE4E_QA_ONLY_REFUSED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='katosync.mesh_devices'::pg_catalog.regclass
      AND tgname='katosync_mesh_device_identity_before_update'
      AND NOT tgisinternal AND tgenabled='O'
  ) THEN RAISE EXCEPTION 'KATOSYNC_STAGE4E_IDENTITY_GUARD_REQUIRED';
  END IF;
END $qa$;

CREATE OR REPLACE FUNCTION katosync.mesh_device_quota_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $freeze$
BEGIN
  RAISE EXCEPTION 'KATOSYNC_MESH_ENROLLMENT_FROZEN' USING ERRCODE='23514';
END $freeze$;
REVOKE ALL ON FUNCTION katosync.mesh_device_quota_guard()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_device_quota_guard() TO service_role;

-- DO NOT restore coalesce(allowed,2), drop the identity UPDATE trigger,
-- modify entitlements or delete existing device records during a freeze.
