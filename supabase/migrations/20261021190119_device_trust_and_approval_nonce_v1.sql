-- KatoSync #76 private account/project membership, device ownership and
-- one-time approval challenges. REVIEW ONLY. No deployment.
-- Generated through Supabase CLI; run after private lease/approval migrations.
-- Service role is a SERVER-ONLY credential. All rows here must be written
-- after independent operator authorization; SQL alone does NOT authenticate.
CREATE TABLE katosync_private.project_memberships (
  account_id uuid NOT NULL,
  project_id text NOT NULL CHECK (project_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','approver','viewer')),
  revoked_at timestamptz,
  PRIMARY KEY(account_id,project_id,user_id)
);
CREATE TABLE katosync_private.trusted_devices (
  account_id uuid NOT NULL,
  device_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  signing_public_key_pem text NOT NULL CHECK (
    length(signing_public_key_pem) BETWEEN 80 AND 3000
    AND signing_public_key_pem LIKE '-----BEGIN PUBLIC KEY-----%'
  ),
  trusted boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  PRIMARY KEY(account_id,device_id)
);
CREATE TABLE katosync_private.approval_challenges (
  challenge_id uuid PRIMARY KEY,
  nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{42,60}$'),
  account_id uuid NOT NULL,
  project_id text NOT NULL CHECK (project_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  task_id uuid NOT NULL,
  executor_device_id uuid NOT NULL,
  approver_device_id uuid NOT NULL,
  expected_head text NOT NULL CHECK(expected_head ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  scope text NOT NULL CHECK(scope='edit_worktree'),
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK(expires_at > created_at AND expires_at <= created_at + interval '90 seconds'),
  CHECK(consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE UNIQUE INDEX approval_challenges_account_nonce_unique
  ON katosync_private.approval_challenges(account_id,nonce);
CREATE INDEX approval_challenges_expires_idx
  ON katosync_private.approval_challenges(expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE katosync_private.project_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE katosync_private.trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE katosync_private.approval_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync_private.project_memberships FROM PUBLIC, anon, authenticated;
REVOKE ALL ON katosync_private.trusted_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON katosync_private.approval_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON katosync_private.project_memberships TO service_role;
GRANT SELECT, INSERT, UPDATE ON katosync_private.trusted_devices TO service_role;
GRANT SELECT, INSERT, UPDATE ON katosync_private.approval_challenges TO service_role;

-- Membership may be revoked but may not be silently moved to another user,
-- account or project. Revocation is one-way.
CREATE FUNCTION katosync_private.membership_update_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$
BEGIN
 IF NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.role IS DISTINCT FROM OLD.role
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
 THEN RAISE EXCEPTION 'Immutable membership cannot be retargeted or unrevoked'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_project_membership
 BEFORE UPDATE ON katosync_private.project_memberships
 FOR EACH ROW EXECUTE FUNCTION katosync_private.membership_update_guard();

-- A device cannot be rebound to a different owner or swapped signing keys.
-- Key rotation requires separate audited re-enrollment after revocation.
CREATE FUNCTION katosync_private.trusted_device_update_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$
BEGIN
 IF NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.signing_public_key_pem IS DISTINCT FROM OLD.signing_public_key_pem
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (OLD.trusted = false AND NEW.trusted = true)
 THEN RAISE EXCEPTION 'Device enrollment immutable: verify and enroll a new key'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_trusted_device
 BEFORE UPDATE ON katosync_private.trusted_devices
 FOR EACH ROW EXECUTE FUNCTION katosync_private.trusted_device_update_guard();

CREATE FUNCTION katosync_private.challenge_update_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$
BEGIN
 IF NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
    OR NEW.nonce IS DISTINCT FROM OLD.nonce
    OR NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.task_id IS DISTINCT FROM OLD.task_id
    OR NEW.executor_device_id IS DISTINCT FROM OLD.executor_device_id
    OR NEW.approver_device_id IS DISTINCT FROM OLD.approver_device_id
    OR NEW.expected_head IS DISTINCT FROM OLD.expected_head
    OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
    OR (OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
        AND NEW.consumed_at < OLD.created_at)
 THEN RAISE EXCEPTION 'One-time challenge cannot be mutated or reset'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_approval_challenge
 BEFORE UPDATE ON katosync_private.approval_challenges
 FOR EACH ROW EXECUTE FUNCTION katosync_private.challenge_update_guard();

-- Atomic UPDATE ... RETURNING; only one concurrent caller may win.
-- Explicitly scope to verified session and actor; broker must recheck project
-- and device membership before persisting an approval receipt.
CREATE FUNCTION katosync_private.consume_approval_challenge(
  p_challenge_id uuid,p_user_id uuid,p_session_id uuid
) RETURNS TABLE (
  challenge_id uuid, nonce text, account_id uuid, project_id text,
  task_id uuid, executor_device_id uuid, approver_device_id uuid,
  expected_head text, scope text, user_id uuid, session_id uuid,
  expires_at timestamptz
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$
BEGIN
 RETURN QUERY
  UPDATE katosync_private.approval_challenges AS c
     SET consumed_at=clock_timestamp()
   WHERE c.challenge_id=p_challenge_id AND c.user_id=p_user_id
     AND c.session_id=p_session_id AND c.consumed_at IS NULL
     AND c.expires_at > clock_timestamp()
   RETURNING c.challenge_id,c.nonce,c.account_id,c.project_id,c.task_id,
    c.executor_device_id,c.approver_device_id,c.expected_head,c.scope,
    c.user_id,c.session_id,c.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION katosync_private.consume_approval_challenge(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync_private.consume_approval_challenge(uuid,uuid,uuid)
 TO service_role;
REVOKE ALL ON FUNCTION katosync_private.membership_update_guard()
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION katosync_private.trusted_device_update_guard()
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION katosync_private.challenge_update_guard()
 FROM PUBLIC,anon,authenticated;

-- Boundaries: server-only identity/session verification, enrollment checks,
-- user-presence consent proof, audit and key handling still REQUIRED.
-- Private schema must NOT be added to exposed Supabase Data API schemas.
