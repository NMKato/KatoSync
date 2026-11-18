-- NMKato Solutions – KatoSync 4.0 Gate 5 / feature owner authority.
-- Additive server-controlled registry. NO default projects/users/approvers.
-- A valid login or active Mesh membership never creates an approver.
-- All writes are reserved for trusted service_role/admin operations.
-- Authenticated and anon receive NO grants or policies on these tables.

CREATE TABLE katosync.feature_approval_projects (
  project_id text PRIMARY KEY
    CHECK (length(project_id) BETWEEN 1 AND 80
      AND project_id ~ '^[A-Za-z0-9_.:-]+$'),
  repository_full_name text NOT NULL
    CHECK (length(repository_full_name) BETWEEN 3 AND 200
      AND repository_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  state text NOT NULL DEFAULT 'staged'
    CHECK (state IN ('staged','active','suspended','revoked')),
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_project_activation_evidence CHECK (
    (state='active' AND approved_at IS NOT NULL AND revoked_at IS NULL)
    OR (state IN ('staged','suspended') AND revoked_at IS NULL)
    OR (state='revoked' AND revoked_at IS NOT NULL)
  )
);
ALTER TABLE katosync.feature_approval_projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.feature_approval_projects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON katosync.feature_approval_projects TO service_role;
COMMENT ON TABLE katosync.feature_approval_projects IS
  'Admin-registered project approvals. No automatic approval from GitHub, Mesh, KATOOS login or client-supplied project IDs.';

CREATE TABLE katosync.feature_approver_grants (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL REFERENCES katosync.feature_approval_projects(project_id)
    ON DELETE RESTRICT,
  subject_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('project_owner','feature_approver')),
  permission text NOT NULL DEFAULT 'approve_feature_acceptance'
    CHECK (permission='approve_feature_acceptance'),
  owner_key_id text NOT NULL
    CHECK (owner_key_id ~ '^ed25519-sha256:[0-9a-f]{64}$'),
  owner_signing_public_key text NOT NULL
    CHECK (length(owner_signing_public_key)=43
      AND owner_signing_public_key ~ '^[A-Za-z0-9_-]+$'),
  grant_revision bigint NOT NULL CHECK (grant_revision > 0),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','active','suspended','revoked')),
  authorized_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_grant_activation_evidence CHECK (
    (state='active' AND authorized_at IS NOT NULL AND revoked_at IS NULL)
    OR (state IN ('pending','suspended') AND revoked_at IS NULL)
    OR (state='revoked' AND revoked_at IS NOT NULL)
  ),
  UNIQUE(project_id,subject_uid,grant_revision)
);
-- During rotation the previous active key must be revoked/suspended first.
CREATE UNIQUE INDEX feature_approver_exact_active_owner
  ON katosync.feature_approver_grants(project_id,subject_uid)
  WHERE state='active';
CREATE INDEX feature_approver_project_subject_lookup
  ON katosync.feature_approver_grants(project_id,subject_uid,state);
ALTER TABLE katosync.feature_approver_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.feature_approver_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON katosync.feature_approver_grants TO service_role;
COMMENT ON TABLE katosync.feature_approver_grants IS
  'Server-administered, revocable, project-scoped public key/role binding. No self-enrollment, never a paid-tier or Mesh permission.';

CREATE TABLE katosync.feature_approver_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES katosync.feature_approver_grants(grant_id)
    ON DELETE RESTRICT,
  project_id text NOT NULL,
  subject_uid uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('provision','transition')),
  previous_state text,
  new_state text NOT NULL,
  grant_revision bigint NOT NULL,
  key_id text NOT NULL,
  actor_role text NOT NULL DEFAULT current_user,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feature_approver_audit_owner_history
  ON katosync.feature_approver_audit(project_id,subject_uid,audit_id);
ALTER TABLE katosync.feature_approver_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.feature_approver_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON katosync.feature_approver_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE katosync.feature_approver_audit_audit_id_seq TO service_role;

-- Audit records are written by the same privileged transaction as each
-- administrative mutation. No SECURITY DEFINER, no end-user RPC.
CREATE FUNCTION katosync.feature_approver_audit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FEATURE_APPROVER_DELETE_FORBIDDEN';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- A revoked key can never become active again. Rotation requires a new
    -- monotonically numbered record; key, subject, role are immutable.
    IF OLD.state='revoked'
      OR NEW.grant_id IS DISTINCT FROM OLD.grant_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.subject_uid IS DISTINCT FROM OLD.subject_uid
      OR NEW.owner_key_id IS DISTINCT FROM OLD.owner_key_id
      OR NEW.owner_signing_public_key IS DISTINCT FROM OLD.owner_signing_public_key
      OR NEW.grant_revision IS DISTINCT FROM OLD.grant_revision
      OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW.permission IS DISTINCT FROM OLD.permission
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.authorized_at IS DISTINCT FROM OLD.authorized_at
    THEN
      RAISE EXCEPTION 'FEATURE_APPROVER_IMMUTABLE_IDENTITY';
    END IF;
    IF OLD.state='active' AND NEW.state NOT IN ('suspended','revoked')
       OR OLD.state='suspended' AND NEW.state NOT IN ('revoked')
       OR OLD.state='pending' AND NEW.state NOT IN ('active','suspended','revoked')
    THEN
      RAISE EXCEPTION 'FEATURE_APPROVER_INVALID_TRANSITION';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION katosync.feature_approver_audit_guard() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION katosync.feature_approver_write_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  INSERT INTO katosync.feature_approver_audit
    (grant_id,project_id,subject_uid,action,previous_state,new_state,
     grant_revision,key_id,actor_role)
  VALUES (NEW.grant_id,NEW.project_id,NEW.subject_uid,
     CASE WHEN TG_OP='INSERT' THEN 'provision' ELSE 'transition' END,
     CASE WHEN TG_OP='UPDATE' THEN OLD.state ELSE NULL END,
     NEW.state,NEW.grant_revision,NEW.owner_key_id,current_user);
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION katosync.feature_approver_write_audit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER feature_approver_before_update_delete
  BEFORE UPDATE OR DELETE ON katosync.feature_approver_grants
  FOR EACH ROW EXECUTE FUNCTION katosync.feature_approver_audit_guard();
CREATE TRIGGER feature_approver_after_insert_update
  AFTER INSERT OR UPDATE ON katosync.feature_approver_grants
  FOR EACH ROW EXECUTE FUNCTION katosync.feature_approver_write_audit();

CREATE FUNCTION katosync.feature_approver_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog AS $function$
BEGIN
 RAISE EXCEPTION 'FEATURE_APPROVER_AUDIT_APPEND_ONLY';
END
$function$;
REVOKE ALL ON FUNCTION katosync.feature_approver_audit_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER feature_approver_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON katosync.feature_approver_audit
  FOR EACH ROW EXECUTE FUNCTION katosync.feature_approver_audit_immutable();

-- No grant row or project is provisioned by this migration. Even
-- service_role reads return empty data until explicit admin approval.
