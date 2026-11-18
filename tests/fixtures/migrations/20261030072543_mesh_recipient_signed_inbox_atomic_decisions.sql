-- NMKato Solutions / KatoSync Stage 2O.
-- Staged only. Require device-possessed Ed25519 proof for inbox reads and decisions.
-- IMPORTANT: Do not deploy until Stage 2L and this migration have both passed QA.
-- Owner RLS alone is insufficient for a device-specific inbox: revoke direct read.
REVOKE SELECT ON katosync.mesh_invites FROM authenticated;
CREATE TABLE katosync.mesh_inbox_proofs (
  proof_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  nonce text not null CHECK (nonce ~ '^[A-Za-z0-9_-]{43}$'),
  action text not null CHECK (action IN ('list','accept','reject')),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  CONSTRAINT mesh_inbox_proof_owner_device_fk FOREIGN KEY (owner_user_id, device_id)
    REFERENCES katosync.mesh_devices(owner_user_id,device_id),
  CONSTRAINT mesh_inbox_proof_window CHECK (
    expires_at > created_at - interval '10 seconds'
    AND expires_at <= created_at + interval '90 seconds'
  ),
  CONSTRAINT mesh_inbox_proof_nonce_unique UNIQUE(owner_user_id, device_id, nonce)
);
CREATE INDEX katosync_mesh_inbox_proofs_owner_recent
 ON katosync.mesh_inbox_proofs(owner_user_id,device_id,created_at DESC);
ALTER TABLE katosync.mesh_inbox_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.mesh_inbox_proofs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON katosync.mesh_inbox_proofs TO service_role;

CREATE FUNCTION katosync.mesh_inbox_proof_rate_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE recent_count integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(new.owner_user_id::text)::bigint
  );
  SELECT count(*) INTO recent_count FROM katosync.mesh_inbox_proofs
   WHERE owner_user_id = new.owner_user_id
     AND device_id = new.device_id
     AND created_at >= pg_catalog.now() - interval '1 minute';
  IF recent_count >= 12 THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_INBOX_PROOF_RATE_LIMIT' USING errcode='23514';
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION katosync.mesh_inbox_proof_rate_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_inbox_proof_rate_guard() TO service_role;
CREATE TRIGGER katosync_mesh_inbox_proof_rate_before_insert
 BEFORE INSERT ON katosync.mesh_inbox_proofs
 FOR EACH ROW EXECUTE FUNCTION katosync.mesh_inbox_proof_rate_guard();

-- Defense in depth: service-role code may only resolve an unexpired, pending
-- invitation. Never change ownership, keys, signed payload, deadlines or grant trust.
CREATE FUNCTION katosync.mesh_inbox_resolution_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF old.state <> 'pending' OR old.expires_at <= pg_catalog.now()
     OR new.state NOT IN ('accepted','rejected')
     OR new.resolved_at IS NULL
     OR new.resolved_at < old.created_at
     OR new.resolved_at > pg_catalog.now() + interval '10 seconds'
     OR new.owner_user_id IS DISTINCT FROM old.owner_user_id
     OR new.source_device_id IS DISTINCT FROM old.source_device_id
     OR new.target_device_id IS DISTINCT FROM old.target_device_id
     OR new.nonce IS DISTINCT FROM old.nonce
     OR new.signed_offer IS DISTINCT FROM old.signed_offer
     OR new.dispatch_signature IS DISTINCT FROM old.dispatch_signature
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.expires_at IS DISTINCT FROM old.expires_at
     OR new.request_id IS DISTINCT FROM old.request_id THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_INBOX_INVALID_RESOLUTION' USING errcode='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM katosync.mesh_devices d
     WHERE d.device_id=old.source_device_id
       AND d.owner_user_id=old.owner_user_id
       AND d.membership_state='discovered' AND d.revoked_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM katosync.mesh_devices d
     WHERE d.device_id=old.target_device_id
       AND d.owner_user_id=old.owner_user_id
       AND d.membership_state='discovered' AND d.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_INBOX_REVOKED_DEVICE'
      USING errcode='23514';
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION katosync.mesh_inbox_resolution_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_inbox_resolution_guard() TO service_role;
CREATE TRIGGER katosync_mesh_inbox_resolution_before_update
 BEFORE UPDATE ON katosync.mesh_invites
 FOR EACH ROW EXECUTE FUNCTION katosync.mesh_inbox_resolution_guard();

COMMENT ON TABLE katosync.mesh_inbox_proofs IS
 'Device-attested, single-use inbox proof registry; no trust, TLS pin or remote task privileges.';
COMMENT ON FUNCTION katosync.mesh_inbox_resolution_guard() IS
 'Only pending and unexpired queue entries can be accepted/rejected. This NEVER pairs devices.';
