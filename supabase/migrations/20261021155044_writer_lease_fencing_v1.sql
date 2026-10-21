-- KatoSync #76: isolated proposed lease authority, NOT deployed.
-- Created with supabase migration new writer_lease_fencing_v1 on 2026-10-21.
-- Keep this schema outside the Data API. Only a trusted KatoSync backend may
-- call these functions with verified account/device/task/approval scopes.
-- Never expose service_role credentials to the desktop application.
CREATE SCHEMA IF NOT EXISTS katosync_private;
REVOKE ALL ON SCHEMA katosync_private FROM PUBLIC;
GRANT USAGE ON SCHEMA katosync_private TO service_role;

CREATE TABLE katosync_private.writer_leases (
  account_id uuid NOT NULL,
  project_id text NOT NULL CHECK (project_id ~ '^[a-zA-Z0-9_.:-]{1,160}$'),
  lease_id uuid NOT NULL,
  holder_device_id uuid NOT NULL,
  task_id uuid NOT NULL,
  approval_id uuid NOT NULL,
  expected_head text NOT NULL CHECK (
    expected_head ~ '^([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$'
  ),
  fence bigint NOT NULL CHECK (fence > 0),
  expires_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, project_id),
  UNIQUE (lease_id)
);

-- RLS defense-in-depth. In Supabase service_role is trusted backend-only and
-- has BYPASSRLS; no anon/authenticated policy or privileges are granted.
ALTER TABLE katosync_private.writer_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync_private.writer_leases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON katosync_private.writer_leases TO service_role;
-- Intentionally NO DELETE grant. Never delete a project lease row or reset
-- its fence: old writers might otherwise reuse an earlier fencing number.

CREATE FUNCTION katosync_private.acquire_writer_lease(
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
  -- PK uniqueness + ON CONFLICT UPDATE row lock provides atomic same-project
  -- single-writer allocation under normal PostgreSQL read committed semantics.
  -- A fresh successful acquisition ALWAYS receives a new UUID and higher fence.
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

CREATE FUNCTION katosync_private.renew_writer_lease(
  p_account_id uuid, p_project_id text, p_device_id uuid,
  p_task_id uuid, p_approval_id uuid, p_lease_id uuid, p_fence bigint,
  p_expected_head text, p_ttl_seconds integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE v_changed integer;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 15 OR p_ttl_seconds > 120
     OR p_expected_head IS NULL THEN
    RETURN false;
  END IF;
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

CREATE FUNCTION katosync_private.check_writer_lease(
  p_account_id uuid, p_project_id text, p_device_id uuid,
  p_task_id uuid, p_approval_id uuid, p_lease_id uuid, p_fence bigint,
  p_expected_head text
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM katosync_private.writer_leases AS wl
    WHERE wl.account_id = p_account_id AND wl.project_id = p_project_id
      AND wl.holder_device_id = p_device_id AND wl.task_id = p_task_id
      AND wl.approval_id = p_approval_id AND wl.lease_id = p_lease_id
      AND wl.fence = p_fence AND wl.expected_head = lower(p_expected_head)
      AND wl.expires_at > clock_timestamp()
  );
$$;

CREATE FUNCTION katosync_private.release_writer_lease(
  p_account_id uuid, p_project_id text, p_device_id uuid,
  p_task_id uuid, p_approval_id uuid, p_lease_id uuid, p_fence bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE v_changed integer;
BEGIN
  UPDATE katosync_private.writer_leases AS wl
     SET expires_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE wl.account_id = p_account_id AND wl.project_id = p_project_id
     AND wl.holder_device_id = p_device_id AND wl.task_id = p_task_id
     AND wl.approval_id = p_approval_id AND wl.lease_id = p_lease_id
     AND wl.fence = p_fence AND wl.expires_at > clock_timestamp();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

-- PostgreSQL normally grants function EXECUTE to PUBLIC: revoke explicitly.
REVOKE ALL ON FUNCTION katosync_private.acquire_writer_lease(uuid,text,uuid,uuid,uuid,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katosync_private.renew_writer_lease(uuid,text,uuid,uuid,uuid,uuid,bigint,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katosync_private.check_writer_lease(uuid,text,uuid,uuid,uuid,uuid,bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katosync_private.release_writer_lease(uuid,text,uuid,uuid,uuid,uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katosync_private.acquire_writer_lease(uuid,text,uuid,uuid,uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION katosync_private.renew_writer_lease(uuid,text,uuid,uuid,uuid,uuid,bigint,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION katosync_private.check_writer_lease(uuid,text,uuid,uuid,uuid,uuid,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION katosync_private.release_writer_lease(uuid,text,uuid,uuid,uuid,uuid,bigint) TO service_role;

-- SECURITY INVARIANT: This only controls DB-issued lease records.
-- The native runner is NOT connected or authorized by this migration.
-- Backend must authenticate/authorize membership + task-approved scope before
-- calling acquire. Remote executor must fence every privileged operation,
-- fail closed if coordinator unavailable, cancel on lost lease, and prevent
-- stale subprocess side effects. A DB lease alone is NOT an OS sandbox.
