-- NMKato Solutions, 2026-10-31. STAGED / DO NOT DEPLOY.
-- Signed ephemeral challenge/response transport, not peer trust or remote jobs.
-- Requires all prior Mesh Inbox, signature binding and membership migrations.
CREATE TABLE katosync.mesh_pairing_relay_messages (
 message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL REFERENCES katosync.mesh_invites(request_id) ON DELETE CASCADE,
 sender_device_id uuid NOT NULL,
 recipient_device_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('challenge','response')),
 payload_b64 text NOT NULL CHECK (
  char_length(payload_b64) BETWEEN 20 AND 11000
  AND payload_b64 ~ '^[A-Za-z0-9_-]+$'
 ),
 nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{43}$'),
 signature text NOT NULL CHECK (signature ~ '^[A-Za-z0-9_-]{86}$'),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mesh_relay_distinct_devices CHECK (sender_device_id <> recipient_device_id),
 CONSTRAINT mesh_relay_time_bound CHECK (
  expires_at > created_at AND expires_at <= created_at + interval '5 minutes'
 ),
 CONSTRAINT mesh_relay_sender_owner FOREIGN KEY (owner_user_id,sender_device_id)
  REFERENCES katosync.mesh_devices(owner_user_id,device_id),
 CONSTRAINT mesh_relay_recipient_owner FOREIGN KEY (owner_user_id,recipient_device_id)
  REFERENCES katosync.mesh_devices(owner_user_id,device_id),
 CONSTRAINT mesh_relay_single_step UNIQUE(owner_user_id,request_id,kind),
 CONSTRAINT mesh_relay_nonce_unique UNIQUE(owner_user_id,sender_device_id,nonce)
);
CREATE INDEX mesh_relay_target_inbox
 ON katosync.mesh_pairing_relay_messages(owner_user_id,recipient_device_id,created_at DESC);
ALTER TABLE katosync.mesh_pairing_relay_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.mesh_pairing_relay_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON katosync.mesh_pairing_relay_messages TO service_role;

-- Database-level atomic role, invitation-state, revoke and expiry guards.
-- These protect against an Edge bug/competing send; *cryptography* is verified
-- in the issuer-verified Edge service before service_role INSERT.
CREATE FUNCTION katosync.mesh_pairing_relay_insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION katosync.mesh_pairing_relay_insert_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_pairing_relay_insert_guard() TO service_role;
CREATE TRIGGER mesh_relay_before_insert BEFORE INSERT
 ON katosync.mesh_pairing_relay_messages FOR EACH ROW
 EXECUTE FUNCTION katosync.mesh_pairing_relay_insert_guard();

-- The recipient must sign each READ. A nonce may be used once.
CREATE TABLE katosync.mesh_pairing_relay_reads (
 proof_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 device_id uuid NOT NULL,
 nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{43}$'),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mesh_relay_read_device FOREIGN KEY (owner_user_id,device_id)
  REFERENCES katosync.mesh_devices(owner_user_id,device_id),
 CONSTRAINT mesh_relay_read_expiry CHECK (
  expires_at > created_at - interval '10 seconds' AND
  expires_at <= created_at + interval '90 seconds'
 ),
 CONSTRAINT mesh_relay_read_nonce UNIQUE(owner_user_id,device_id,nonce)
);
CREATE INDEX mesh_relay_reads_recent
 ON katosync.mesh_pairing_relay_reads(owner_user_id,device_id,created_at DESC);
ALTER TABLE katosync.mesh_pairing_relay_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.mesh_pairing_relay_reads FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON katosync.mesh_pairing_relay_reads TO service_role;
CREATE FUNCTION katosync.mesh_relay_read_rate_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE recent integer;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.owner_user_id::text)::bigint);
 SELECT count(*) INTO recent FROM katosync.mesh_pairing_relay_reads
 WHERE owner_user_id=new.owner_user_id AND device_id=new.device_id
 AND created_at >= pg_catalog.now()-interval '1 minute';
 IF recent >= 12 THEN
  RAISE EXCEPTION 'KATOSYNC_MESH_RELAY_READ_RATE_LIMIT' USING errcode='23514';
 END IF;
 RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION katosync.mesh_relay_read_rate_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_relay_read_rate_guard() TO service_role;
CREATE TRIGGER mesh_relay_read_before_insert BEFORE INSERT
 ON katosync.mesh_pairing_relay_reads FOR EACH ROW
 EXECUTE FUNCTION katosync.mesh_relay_read_rate_guard();

COMMENT ON TABLE katosync.mesh_pairing_relay_messages IS
 'QA-staged, short-lived independently device-signed public challenge/response. NEVER peer trust.';
COMMENT ON TABLE katosync.mesh_pairing_relay_reads IS
 'QA-staged nonce-replay-guarded signed reads. No background polling permission.';
