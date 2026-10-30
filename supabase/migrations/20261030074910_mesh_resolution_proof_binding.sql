-- NMKato Solutions — Stage 2O.1 security review: bind each resolution to an
-- actual single-use recipient proof and the currently enrolled sender key.
-- Additive only, NOT deployed; requires Stage 2L and 2O migrations first.
ALTER TABLE katosync.mesh_invites
  ADD COLUMN resolution_proof_id uuid
    REFERENCES katosync.mesh_inbox_proofs(proof_id),
  ADD CONSTRAINT mesh_invite_resolution_proof_unique UNIQUE(resolution_proof_id);

-- A pending invite has no resolution proof. Every resolved invite must record
-- its exact device-attested proof. Enforced on new writes and updates.
ALTER TABLE katosync.mesh_invites
  ADD CONSTRAINT mesh_invite_proof_resolution_consistency CHECK (
    (state='pending' AND resolution_proof_id IS NULL)
    OR (state IN ('accepted','rejected') AND resolution_proof_id IS NOT NULL)
    OR (state IN ('cancelled','expired') AND resolution_proof_id IS NULL)
  ) NOT VALID;
-- Do not VALIDATE until any pre-existing resolved rows are reviewed. The QA
-- preflight checks the table before the eventual deployment.

CREATE FUNCTION katosync.mesh_inbox_resolution_proof_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE matching_proof boolean;
BEGIN
  IF OLD.state<>'pending' OR OLD.resolution_proof_id IS NOT NULL
     OR NEW.state NOT IN ('accepted','rejected')
     OR NEW.resolution_proof_id IS NULL THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_INBOX_PROOF_REQUIRED'
      USING errcode='23514';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM katosync.mesh_inbox_proofs p
    WHERE p.proof_id=NEW.resolution_proof_id
      AND p.owner_user_id=OLD.owner_user_id
      AND p.device_id=OLD.target_device_id
      AND p.request_id=OLD.request_id
      AND p.action=CASE NEW.state WHEN 'accepted' THEN 'accept' ELSE 'reject' END
      AND p.expires_at>pg_catalog.now()
      AND p.created_at>=pg_catalog.now()-interval '90 seconds'
      AND p.created_at<=pg_catalog.now()+interval '10 seconds'
  ) INTO matching_proof;
  IF NOT matching_proof THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_INBOX_PROOF_MISMATCH'
      USING errcode='23514';
  END IF;
  -- Detect a sender key rotation/re-registration after invitation creation.
  IF NOT EXISTS (
    SELECT 1 FROM katosync.mesh_devices d
    WHERE d.device_id=OLD.source_device_id
      AND d.owner_user_id=OLD.owner_user_id
      AND d.membership_state='discovered'
      AND d.revoked_at IS NULL
      AND d.signing_public_key=OLD.signed_offer->>'publicKey'
  ) THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_INBOX_SOURCE_KEY_CHANGED'
      USING errcode='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION katosync.mesh_inbox_resolution_proof_guard()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_inbox_resolution_proof_guard()
  TO service_role;
CREATE TRIGGER katosync_mesh_inbox_resolution_proof_before_update
  BEFORE UPDATE ON katosync.mesh_invites FOR EACH ROW
  EXECUTE FUNCTION katosync.mesh_inbox_resolution_proof_guard();

COMMENT ON FUNCTION katosync.mesh_inbox_resolution_proof_guard() IS
 'Every recipient decision requires a fresh target-device proof with matching owner, request and action. Never grants peer trust.';
