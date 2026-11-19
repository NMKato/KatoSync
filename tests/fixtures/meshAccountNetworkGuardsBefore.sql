-- Created by NMKato Solutions
-- Verifizierter Vorzustand fuer den engen discovered/trusted-Regressionsvergleich.
CREATE OR REPLACE FUNCTION katosync.mesh_inbox_proof_recipient_key_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION katosync.mesh_inbox_recipient_key_resolution_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION katosync.mesh_inbox_resolution_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION katosync.mesh_inbox_resolution_proof_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION katosync.mesh_pairing_relay_insert_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE invite record;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.owner_user_id::text)::bigint);
 SELECT owner_user_id,source_device_id,target_device_id,state,expires_at
 INTO invite FROM katosync.mesh_invites WHERE request_id=new.request_id;
 IF NOT FOUND OR invite.owner_user_id IS DISTINCT FROM new.owner_user_id
   OR invite.state <> 'accepted' OR invite.expires_at <= pg_catalog.now()
   OR new.expires_at > invite.expires_at
   OR (new.kind='challenge' AND
      (new.sender_device_id <> invite.target_device_id OR new.recipient_device_id <> invite.source_device_id))
   OR (new.kind='response' AND
      (new.sender_device_id <> invite.source_device_id OR new.recipient_device_id <> invite.target_device_id))
   OR NOT EXISTS (
      SELECT 1 FROM katosync.mesh_devices
      WHERE owner_user_id=new.owner_user_id
      AND device_id=new.sender_device_id
      AND membership_state='discovered' AND revoked_at IS NULL)
   OR NOT EXISTS (
      SELECT 1 FROM katosync.mesh_devices
      WHERE owner_user_id=new.owner_user_id
      AND device_id=new.recipient_device_id
      AND membership_state='discovered' AND revoked_at IS NULL) THEN
  RAISE EXCEPTION 'KATOSYNC_MESH_RELAY_NOT_ELIGIBLE' USING errcode='23514';
 END IF;
 IF new.kind='response' AND NOT EXISTS (
   SELECT 1 FROM katosync.mesh_pairing_relay_messages prior
   WHERE prior.owner_user_id=new.owner_user_id
    AND prior.request_id=new.request_id AND prior.kind='challenge'
    AND prior.expires_at > pg_catalog.now()
 ) THEN
  RAISE EXCEPTION 'KATOSYNC_MESH_RELAY_NO_CHALLENGE' USING errcode='23514';
 END IF;
 RETURN new;
END;
$function$;
