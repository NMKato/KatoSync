-- KatoSync #76 approval/lease binding: REVIEW-ONLY, NOT DEPLOYED.
-- Applied strictly AFTER 20261021155044_writer_lease_fencing_v1.sql.
-- This SQL never authenticates users or devices. Only a trusted backend with
-- independently verified consent and account/project/device membership can
-- insert task approvals. Never expose service_role or this schema to clients.

CREATE TABLE katosync_private.task_approvals (
  approval_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  project_id text NOT NULL CHECK (project_id ~ '^[a-zA-Z0-9_.:-]{1,160}$'),
  device_id uuid NOT NULL,
  task_id uuid NOT NULL,
  expected_head text NOT NULL CHECK (expected_head ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  approved_by uuid NOT NULL,
  proof_digest_sha256 text NOT NULL CHECK (proof_digest_sha256 ~ '^[0-9a-f]{64}$'),
  capabilities text[] NOT NULL CHECK (capabilities = ARRAY['edit_worktree']::text[]),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > approved_at AND expires_at <= approved_at + interval '1 hour'),
  CHECK (revoked_at IS NULL OR revoked_at >= approved_at),
  UNIQUE (account_id, project_id, approval_id)
);

-- No client grants; defense in depth RLS even in nonexposed schema.
ALTER TABLE katosync_private.task_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync_private.task_approvals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON katosync_private.task_approvals TO service_role;

-- Approval metadata is immutable. Revocation is the only permitted update.
-- Does not replace verifying actor identity and user consent in backend.
CREATE FUNCTION katosync_private.prevent_approval_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$
BEGIN
  IF NEW.approval_id IS DISTINCT FROM OLD.approval_id
    OR NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.task_id IS DISTINCT FROM OLD.task_id
    OR NEW.expected_head IS DISTINCT FROM OLD.expected_head
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.proof_digest_sha256 IS DISTINCT FROM OLD.proof_digest_sha256
    OR NEW.capabilities IS DISTINCT FROM OLD.capabilities
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND NEW.revoked_at < OLD.approved_at)
  THEN
    RAISE EXCEPTION 'Task approval is immutable except for one-way revocation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_approval_immutability
BEFORE UPDATE ON katosync_private.task_approvals
FOR EACH ROW EXECUTE FUNCTION katosync_private.prevent_approval_mutation();

-- Overwrite the legacy unverified lease acquire: a caller-supplied approval_id
-- now NEVER suffices without an authoritative matching, unexpired row.
CREATE OR REPLACE FUNCTION katosync_private.acquire_writer_lease(
  p_account_id uuid, p_project_id text, p_device_id uuid,
  p_task_id uuid, p_approval_id uuid, p_expected_head text, p_ttl_seconds integer
) RETURNS TABLE (
  acquired boolean, granted_lease_id uuid, fencing_token bigint, lease_deadline timestamptz
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF p_account_id IS NULL OR p_device_id IS NULL OR p_task_id IS NULL
     OR p_approval_id IS NULL OR p_project_id IS NULL
     OR p_project_id !~ '^[a-zA-Z0-9_.:-]{1,160}$'
     OR p_expected_head IS NULL
     OR p_expected_head !~ '^([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$'
     OR p_ttl_seconds IS NULL OR p_ttl_seconds < 15 OR p_ttl_seconds > 120
  THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;

  -- FOR SHARE blocks concurrent revoke while acquisition is in flight,
  -- preventing a claim based on an approval already revoked at commit.
  -- Revoking immediately invalidates subsequent lease checks.
  PERFORM 1 FROM katosync_private.task_approvals AS ap
   WHERE ap.approval_id = p_approval_id
     AND ap.account_id = p_account_id
     AND ap.project_id = p_project_id
     AND ap.device_id = p_device_id
     AND ap.task_id = p_task_id
     AND ap.expected_head = lower(p_expected_head)
     AND ap.capabilities = ARRAY['edit_worktree']::text[]
     AND ap.revoked_at IS NULL
     AND ap.expires_at > clock_timestamp()
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY
    INSERT INTO katosync_private.writer_leases AS wl
      (account_id, project_id, lease_id, holder_device_id, task_id,
       approval_id, expected_head, fence, expires_at, issued_at, updated_at)
    VALUES
      (p_account_id, p_project_id, gen_random_uuid(), p_device_id, p_task_id,
       p_approval_id, lower(p_expected_head), 1,
       clock_timestamp() + make_interval(secs => p_ttl_seconds),
       clock_timestamp(), clock_timestamp())
    ON CONFLICT (account_id, project_id)
    DO UPDATE SET
      lease_id = EXCLUDED.lease_id,
      holder_device_id = EXCLUDED.holder_device_id,
      task_id = EXCLUDED.task_id,
      approval_id = EXCLUDED.approval_id,
      expected_head = EXCLUDED.expected_head,
      fence = wl.fence + 1,
      issued_at = clock_timestamp(),
      updated_at = clock_timestamp(),
      expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds)
    WHERE wl.expires_at <= clock_timestamp()
    RETURNING true, wl.lease_id, wl.fence, wl.expires_at;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::bigint, NULL::timestamptz;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION katosync_private.renew_writer_lease(
  p_account_id uuid, p_project_id text, p_device_id uuid,
  p_task_id uuid, p_approval_id uuid, p_lease_id uuid, p_fence bigint,
  p_expected_head text, p_ttl_seconds integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE v_changed integer;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 15 OR p_ttl_seconds > 120
     OR p_expected_head IS NULL THEN RETURN false; END IF;
  PERFORM 1 FROM katosync_private.task_approvals AS ap
   WHERE ap.approval_id = p_approval_id
     AND ap.account_id = p_account_id
     AND ap.project_id = p_project_id
     AND ap.device_id = p_device_id
     AND ap.task_id = p_task_id
     AND ap.expected_head = lower(p_expected_head)
     AND ap.capabilities = ARRAY['edit_worktree']::text[]
     AND ap.revoked_at IS NULL AND ap.expires_at > clock_timestamp()
   FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE katosync_private.writer_leases AS wl
    SET expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds),
        updated_at = clock_timestamp()
   WHERE wl.account_id = p_account_id AND wl.project_id = p_project_id
     AND wl.holder_device_id = p_device_id AND wl.task_id = p_task_id
     AND wl.approval_id = p_approval_id AND wl.lease_id = p_lease_id
     AND wl.fence = p_fence AND wl.expected_head = lower(p_expected_head)
     AND wl.expires_at > clock_timestamp();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION katosync_private.check_writer_lease(
  p_account_id uuid, p_project_id text, p_device_id uuid,
  p_task_id uuid, p_approval_id uuid, p_lease_id uuid, p_fence bigint,
  p_expected_head text
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM katosync_private.writer_leases AS wl
    JOIN katosync_private.task_approvals AS ap
      ON ap.approval_id = wl.approval_id
     AND ap.account_id = wl.account_id
     AND ap.project_id = wl.project_id
     AND ap.device_id = wl.holder_device_id
     AND ap.task_id = wl.task_id
     AND ap.expected_head = wl.expected_head
    WHERE wl.account_id = p_account_id AND wl.project_id = p_project_id
      AND wl.holder_device_id = p_device_id AND wl.task_id = p_task_id
      AND wl.approval_id = p_approval_id AND wl.lease_id = p_lease_id
      AND wl.fence = p_fence AND wl.expected_head = lower(p_expected_head)
      AND wl.expires_at > clock_timestamp()
      AND ap.revoked_at IS NULL AND ap.expires_at > clock_timestamp()
      AND ap.capabilities = ARRAY['edit_worktree']::text[]
  );
$$;

-- Explicit revocation: immediately invalidate the matching lease, retaining
-- its row/fence generation so a stale agent can never reuse a prior generation.
CREATE FUNCTION katosync_private.revoke_task_approval(
  p_account_id uuid, p_approval_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE katosync_private.task_approvals AS ap
     SET revoked_at = clock_timestamp()
   WHERE ap.account_id = p_account_id AND ap.approval_id = p_approval_id
     AND ap.revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RETURN false; END IF;
  UPDATE katosync_private.writer_leases AS wl
     SET expires_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE wl.account_id = p_account_id AND wl.approval_id = p_approval_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION katosync_private.revoke_task_approval(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync_private.revoke_task_approval(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION katosync_private.prevent_approval_mutation() FROM PUBLIC,anon,authenticated;
-- Existing acquire/renew/check signature grants from migration #83 are retained.
-- No authenticated/anon policies or grants and no public-schema RPC endpoints.

-- TODO, REQUIRED before deployment: independently authenticated backend API,
-- verified human approval provenance, enrollment/account/project ownership,
-- audit receipts, check on each mutating operation, and executor cancellation.
