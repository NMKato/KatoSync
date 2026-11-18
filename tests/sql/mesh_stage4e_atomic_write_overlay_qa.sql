-- NMKato Solutions — Stage4E atomic Mesh write admission, QA ONLY.
-- Never copy into supabase/migrations or apply to KATOOS. Unix-socket PG17.
-- The checked owner policy + account membership are locked FOR SHARE
-- inside the SAME DML transaction as the signed Mesh message insertion.
DO $preflight$
BEGIN
 IF pg_catalog.current_setting('katosync.qa_disposable',true)
    IS DISTINCT FROM 'unix-socket-qa-only'
    OR pg_catalog.inet_server_addr() IS NOT NULL
 THEN RAISE EXCEPTION 'KATOSYNC_MESH_ATOMIC_QA_ONLY_REFUSED'
  USING ERRCODE='42501';
 END IF;
 IF to_regclass('katosync.account_memberships') IS NULL
  OR to_regclass('katosync.mesh_pairing_relay_messages') IS NULL
  OR to_regclass('katosync.mesh_pairing_relay_reads') IS NULL
  OR to_regclass('katosync.mesh_inbox_proofs') IS NULL
 THEN RAISE EXCEPTION 'KATOSYNC_MESH_ATOMIC_SCHEMA_INCOMPLETE';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_class
     WHERE oid IN ('katosync.mesh_invites'::regclass,
        'katosync.mesh_inbox_proofs'::regclass,
        'katosync.mesh_pairing_relay_messages'::regclass,
        'katosync.mesh_pairing_relay_reads'::regclass,
        'katosync.mesh_enrollment_challenges'::regclass)
       AND relrowsecurity)<>5
 THEN RAISE EXCEPTION 'KATOSYNC_MESH_ATOMIC_RLS_REQUIRED';
 END IF;
END $preflight$;
-- Called only from server-role DML triggers, never by an authenticated user.
CREATE FUNCTION katosync.mesh_atomic_write_entitlement_qa()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $gate$
DECLARE
  allowed integer;
  expiry timestamptz;
  active_state text;
  revoked timestamptz;
BEGIN
  -- Stable device/invite ownership must not change through an UPDATE.
  IF TG_OP='UPDATE' THEN
    IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
      RAISE EXCEPTION 'KATOSYNC_MESH_ATOMIC_OWNER_IMMUTABLE'
        USING ERRCODE='23514';
    END IF;
    -- Existing SHA-pinned invite resolution guard permits only accept/reject.
    -- Do not silently bypass it to create a new cancel/expire state path.
    -- Operational cancel/expire requires separately reviewed DB migration.
  END IF;
  IF NEW.owner_user_id IS NULL THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
      USING ERRCODE='23514';
  END IF;
  -- Consistent owner advisory lock (same key as the existing device quota),
  -- plus row-level FOR SHARE locks. A concurrent UPDATE/DELETE of either
  -- policy or membership waits until this insert/decision commits.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(NEW.owner_user_id::text)::bigint);
  SELECT p.allowed_devices,p.policy_expires_at
    INTO allowed,expiry
    FROM katosync.mesh_owner_policy p
   WHERE p.owner_user_id=NEW.owner_user_id FOR SHARE;
  IF allowed IS NULL OR allowed<1 OR allowed>10 OR
    (expiry IS NOT NULL AND expiry<=pg_catalog.clock_timestamp())
  THEN RAISE EXCEPTION 'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
    USING ERRCODE='23514';
  END IF;
  SELECT a.access_state,a.revoked_at INTO active_state,revoked
    FROM katosync.account_memberships a
   WHERE a.user_id=NEW.owner_user_id FOR SHARE;
  IF active_state IS DISTINCT FROM 'active' OR revoked IS NOT NULL THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_ACCOUNT_MEMBERSHIP_REQUIRED'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$gate$;
REVOKE ALL ON FUNCTION katosync.mesh_atomic_write_entitlement_qa()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_atomic_write_entitlement_qa()
 TO service_role;
-- Triggers named with "a_" so the membership/quota gate precedes existing
-- rate, replay, invite, and device-signature invariants.
CREATE TRIGGER a_katosync_mesh_atomic_invite_insert
 BEFORE INSERT ON katosync.mesh_invites FOR EACH ROW
 EXECUTE FUNCTION katosync.mesh_atomic_write_entitlement_qa();
CREATE TRIGGER a_katosync_mesh_atomic_invite_update
 BEFORE UPDATE ON katosync.mesh_invites FOR EACH ROW
 EXECUTE FUNCTION katosync.mesh_atomic_write_entitlement_qa();
CREATE TRIGGER a_katosync_mesh_atomic_inbox_proof
 BEFORE INSERT ON katosync.mesh_inbox_proofs FOR EACH ROW
 EXECUTE FUNCTION katosync.mesh_atomic_write_entitlement_qa();
CREATE TRIGGER a_katosync_mesh_atomic_relay_message
 BEFORE INSERT ON katosync.mesh_pairing_relay_messages FOR EACH ROW
 EXECUTE FUNCTION katosync.mesh_atomic_write_entitlement_qa();
CREATE TRIGGER a_katosync_mesh_atomic_relay_read
 BEFORE INSERT ON katosync.mesh_pairing_relay_reads FOR EACH ROW
 EXECUTE FUNCTION katosync.mesh_atomic_write_entitlement_qa();
CREATE TRIGGER a_katosync_mesh_atomic_challenge_insert
 BEFORE INSERT ON katosync.mesh_enrollment_challenges FOR EACH ROW
 EXECUTE FUNCTION katosync.mesh_atomic_write_entitlement_qa();
CREATE TRIGGER a_katosync_mesh_atomic_challenge_consume
 BEFORE UPDATE ON katosync.mesh_enrollment_challenges FOR EACH ROW
 EXECUTE FUNCTION katosync.mesh_atomic_write_entitlement_qa();
-- Only signed heartbeat writes set last_seen_at; do not block revoked_at
-- administrative writes, even after an expired plan.
CREATE TRIGGER a_katosync_mesh_atomic_heartbeat
 BEFORE UPDATE OF last_seen_at ON katosync.mesh_devices FOR EACH ROW
 EXECUTE FUNCTION katosync.mesh_atomic_write_entitlement_qa();
