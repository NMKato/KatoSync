-- Created by NMKato Solutions
-- Eine kontoweite Hauptgeraetwahl ist Topologie, niemals eine Auftragsfreigabe.
-- Private Implementierung: bestehende Auth-ACLs und MCP-Consents bleiben unveraendert.
CREATE SCHEMA katosync_mesh_private;
REVOKE ALL ON SCHEMA katosync_mesh_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA katosync_mesh_private TO authenticated;

CREATE TABLE katosync.mesh_account_network (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  main_device_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mesh_account_network_owner_device_fk
    FOREIGN KEY (owner_user_id, main_device_id)
    REFERENCES katosync.mesh_devices(owner_user_id, device_id)
);
ALTER TABLE katosync.mesh_account_network ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.mesh_account_network FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON katosync.mesh_account_network TO authenticated;
CREATE POLICY mesh_account_network_owner_read
  ON katosync.mesh_account_network FOR SELECT TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));
COMMENT ON TABLE katosync.mesh_account_network IS
  'Kontoweite explizite Topologiewahl mit CAS. Kein Pairing, kein MCP-Grant und keine Ausfuehrungsberechtigung.';

CREATE FUNCTION katosync_mesh_private.require_native_network_owner()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor uuid := auth.uid();
  claims jsonb := auth.jwt();
  native_session uuid;
BEGIN
  IF actor IS NULL OR actor = '00000000-0000-0000-0000-000000000000'::uuid
    OR claims->>'iss' IS DISTINCT FROM 'https://xbnnlyyxiilklsygxcof.supabase.co/auth/v1'
    OR claims->>'aud' IS DISTINCT FROM 'authenticated'
    OR claims->>'role' IS DISTINCT FROM 'authenticated'
    OR claims->>'sub' IS DISTINCT FROM actor::text
    OR claims->'is_anonymous' IS DISTINCT FROM 'false'::jsonb
    OR (claims->'client_id' IS NOT NULL AND claims->'client_id' <> 'null'::jsonb)
    OR (claims->'oauth_client_id' IS NOT NULL AND claims->'oauth_client_id' <> 'null'::jsonb)
    OR (claims->'azp' IS NOT NULL AND claims->'azp' <> 'null'::jsonb)
    OR COALESCE(claims->>'session_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR COALESCE(claims->>'exp', '') !~ '^[0-9]{1,12}$'
  THEN
    RAISE EXCEPTION 'MESH_ACCOUNT_LOGIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF (claims->>'exp')::bigint <= extract(epoch FROM clock_timestamp()) THEN
    RAISE EXCEPTION 'MESH_ACCOUNT_LOGIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  native_session := (claims->>'session_id')::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.id = native_session AND s.user_id = actor AND s.oauth_client_id IS NULL
      AND (s.not_after IS NULL OR s.not_after > clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'MESH_ACCOUNT_LOGIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM katosync.account_memberships m
    WHERE m.user_id = actor AND m.access_state = 'active'
      AND m.authorized_at IS NOT NULL AND m.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'MESH_ACCOUNT_MEMBERSHIP_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN actor;
END;
$function$;

CREATE FUNCTION katosync_mesh_private.account_network_get()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor uuid := katosync_mesh_private.require_native_network_owner();
  result jsonb;
BEGIN
  -- Kein INSERT beim Lesen. Eine noch nicht getroffene Wahl hat Revision 0.
  SELECT jsonb_build_object(
    'version', 1,
    'ownerId', actor,
    'sessionId', auth.jwt()->>'session_id',
    'mainDeviceId', n.main_device_id,
    'accountRevision', COALESCE(n.revision, 0),
    'mainDeviceAvailable', EXISTS (
      SELECT 1 FROM katosync.mesh_devices chosen
      WHERE chosen.owner_user_id = actor AND chosen.device_id = n.main_device_id
        AND chosen.membership_state IN ('discovered', 'trusted') AND chosen.revoked_at IS NULL
    ),
    'devices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'deviceId', d.device_id, 'ownerUserId', d.owner_user_id,
        'displayName', d.display_name, 'personaName', d.persona_name,
        'platformOs', d.platform_os, 'membershipState', d.membership_state,
        'fingerprint', d.fingerprint, 'publicKey', d.signing_public_key,
        'lastSeenAt', d.last_seen_at, 'revoked', d.revoked_at IS NOT NULL
      ) ORDER BY d.created_at, d.device_id)
      FROM (
        SELECT device_id, owner_user_id, display_name, persona_name, platform_os,
          membership_state, fingerprint, signing_public_key, last_seen_at, revoked_at, created_at
        FROM katosync.mesh_devices WHERE owner_user_id = actor
        ORDER BY created_at, device_id LIMIT 11
      ) d
    ), '[]'::jsonb)
  ) INTO result
  FROM (SELECT 1) singleton
  LEFT JOIN katosync.mesh_account_network n ON n.owner_user_id = actor;
  RETURN result;
END;
$function$;

CREATE FUNCTION katosync_mesh_private.account_network_set_primary(
  p_device_id uuid, p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor uuid := katosync_mesh_private.require_native_network_owner();
  current_row katosync.mesh_account_network%ROWTYPE;
  inserted integer;
BEGIN
  IF p_device_id IS NULL OR p_device_id = '00000000-0000-0000-0000-000000000000'::uuid
    OR p_expected_revision IS NULL OR p_expected_revision < 0
    OR p_expected_revision > 9007199254740991
  THEN
    RAISE EXCEPTION 'MESH_ACCOUNT_INVALID_SELECTION' USING ERRCODE = '22023';
  END IF;

  -- Der Share-Lock bleibt bis Commit: Revoke kann nicht nach der Pruefung
  -- vor unserer Auswahl gewinnen. Es gibt keinen umgekehrten Revoke-Trigger.
  PERFORM 1 FROM katosync.mesh_devices d
    WHERE d.owner_user_id = actor AND d.device_id = p_device_id
      AND d.membership_state IN ('discovered', 'trusted') AND d.revoked_at IS NULL
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESH_ACCOUNT_DEVICE_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;

  IF p_expected_revision = 0 THEN
    INSERT INTO katosync.mesh_account_network(owner_user_id, main_device_id, revision)
      VALUES(actor, p_device_id, 1)
      ON CONFLICT (owner_user_id) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    IF inserted = 1 THEN
      RETURN katosync_mesh_private.account_network_get();
    END IF;
  END IF;

  -- Die Owner-PK serialisiert auch zwei konkurrierende Erstauswahlen.
  SELECT * INTO current_row FROM katosync.mesh_account_network
    WHERE owner_user_id = actor FOR UPDATE;
  IF NOT FOUND OR current_row.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'MESH_ACCOUNT_REVISION_CONFLICT' USING ERRCODE = '40001';
  END IF;
  IF current_row.main_device_id = p_device_id THEN
    RETURN katosync_mesh_private.account_network_get();
  END IF;
  IF current_row.revision = 9007199254740991 THEN
    RAISE EXCEPTION 'MESH_ACCOUNT_REVISION_LIMIT' USING ERRCODE = '22003';
  END IF;
  UPDATE katosync.mesh_account_network
    SET main_device_id = p_device_id, revision = current_row.revision + 1,
        updated_at = clock_timestamp()
    WHERE owner_user_id = actor;
  RETURN katosync_mesh_private.account_network_get();
END;
$function$;

-- Exponierte Wrapper haben keine erhoehten Rechte. Owner/Session werden
-- ausschliesslich aus dem verifizierten Data-API-JWT ermittelt.
CREATE FUNCTION katosync.mesh_account_network_get()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$ SELECT katosync_mesh_private.account_network_get(); $function$;
CREATE FUNCTION katosync.mesh_account_network_set_primary(
  p_device_id uuid, p_expected_revision bigint
)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT katosync_mesh_private.account_network_set_primary(p_device_id, p_expected_revision);
$function$;

REVOKE ALL ON FUNCTION katosync_mesh_private.require_native_network_owner()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION katosync_mesh_private.account_network_get()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION katosync_mesh_private.account_network_set_primary(uuid, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION katosync.mesh_account_network_get()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION katosync.mesh_account_network_set_primary(uuid, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION katosync_mesh_private.account_network_get()
  TO authenticated;
GRANT EXECUTE ON FUNCTION katosync_mesh_private.account_network_set_primary(uuid, bigint)
  TO authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_account_network_get() TO authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_account_network_set_primary(uuid, bigint) TO authenticated;

-- Nur bestehende Registryzustaende erweitern; alle Owner-/Key-/Revoke-
-- und Single-use-Bedingungen dieser fuenf produktiven Guards bleiben erhalten.
CREATE OR REPLACE FUNCTION katosync.mesh_inbox_proof_recipient_key_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM 1 FROM katosync.mesh_devices d
    WHERE d.owner_user_id=NEW.owner_user_id
      AND d.device_id=NEW.device_id
      AND d.membership_state IN ('discovered','trusted')
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
        AND d.membership_state IN ('discovered','trusted')
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
       AND d.membership_state IN ('discovered','trusted') AND d.revoked_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM katosync.mesh_devices d
     WHERE d.device_id=old.target_device_id
       AND d.owner_user_id=old.owner_user_id
       AND d.membership_state IN ('discovered','trusted') AND d.revoked_at IS NULL
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
      AND d.membership_state IN ('discovered','trusted')
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
      AND membership_state IN ('discovered','trusted') AND revoked_at IS NULL)
   OR NOT EXISTS (
      SELECT 1 FROM katosync.mesh_devices
      WHERE owner_user_id=new.owner_user_id
      AND device_id=new.recipient_device_id
      AND membership_state IN ('discovered','trusted') AND revoked_at IS NULL) THEN
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


NOTIFY pgrst, 'reload schema';
