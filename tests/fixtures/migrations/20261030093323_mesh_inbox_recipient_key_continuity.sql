-- NMKato Solutions | KatoSync Stage 2S
-- Additive recipient signing-key continuity for device-attested inbox proofs.
-- Applies only AFTER 2L / 2O / 2O.1, never to the live DB from this draft.
-- Legacy proofs (if any) remain readable, but may not authorize NEW decisions.
ALTER TABLE katosync.mesh_inbox_proofs
  ADD COLUMN signing_public_key text,
  ADD CONSTRAINT mesh_inbox_proof_signing_key_required CHECK (
    signing_public_key IS NOT NULL
    AND signing_public_key ~ '^[A-Za-z0-9_-]{43}$'
  ) NOT VALID;

-- A privileged caller cannot insert a proof for a missing, revoked or
-- differently keyed recipient. The row lock serializes concurrent key
-- rotations/revocations with the proof insert transaction.
CREATE FUNCTION katosync.mesh_inbox_proof_recipient_key_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
  PERFORM 1 FROM katosync.mesh_devices d
    WHERE d.owner_user_id=NEW.owner_user_id
      AND d.device_id=NEW.device_id
      AND d.membership_state='discovered'
      AND d.revoked_at IS NULL
      AND d.signing_public_key=NEW.signing_public_key
    FOR SHARE OF d;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'KATOSYNC_MESH_PROOF_RECIPIENT_KEY_MISMATCH'
      USING errcode='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION katosync.mesh_inbox_proof_recipient_key_guard()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_inbox_proof_recipient_key_guard()
  TO service_role;
CREATE TRIGGER katosync_mesh_inbox_proof_key_before_insert
  BEFORE INSERT ON katosync.mesh_inbox_proofs FOR EACH ROW
  EXECUTE FUNCTION katosync.mesh_inbox_proof_recipient_key_guard();

-- Resolution already checks owner, device, request, action and freshness
-- (2O.1). Additionally require that the SAME key is still registered at
-- the time of decision. Hold a shared lock on that registry row until the
-- transaction commits so an in-flight rotation cannot race a decision.
CREATE FUNCTION katosync.mesh_inbox_recipient_key_resolution_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
  IF OLD.state='pending' AND NEW.state IN ('accepted','rejected') THEN
    PERFORM 1
      FROM katosync.mesh_inbox_proofs p
      JOIN katosync.mesh_devices d
        ON d.owner_user_id=p.owner_user_id AND d.device_id=p.device_id
      WHERE p.proof_id=NEW.resolution_proof_id
        AND p.owner_user_id=OLD.owner_user_id
        AND p.device_id=OLD.target_device_id
        AND p.request_id=OLD.request_id
        AND p.action=CASE NEW.state WHEN 'accepted' THEN 'accept' ELSE 'reject' END
        AND p.signing_public_key=d.signing_public_key
        AND d.membership_state='discovered'
        AND d.revoked_at IS NULL
      FOR SHARE OF d;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'KATOSYNC_MESH_INBOX_RECIPIENT_KEY_CHANGED'
        USING errcode='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION katosync.mesh_inbox_recipient_key_resolution_guard()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_inbox_recipient_key_resolution_guard()
  TO service_role;
CREATE TRIGGER katosync_mesh_inbox_recipient_key_resolution_before_update
  BEFORE UPDATE ON katosync.mesh_invites FOR EACH ROW
  EXECUTE FUNCTION katosync.mesh_inbox_recipient_key_resolution_guard();

COMMENT ON COLUMN katosync.mesh_inbox_proofs.signing_public_key IS
  'Device public key verified for this one-time Ed25519 proof; bound to the CURRENT recipient key at resolution. Never grants Mesh trust.';
