-- NMKato Solutions – Gate 5 additive correction after live schema verification.
-- Preserve immutable owner identity while allowing a single explicit
-- pending -> active grant authorization (setting authorized_at once).
-- Revoked grants cannot be reactivated; no user-controlled mutator is added.

CREATE OR REPLACE FUNCTION katosync.feature_approver_audit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'FEATURE_APPROVER_DELETE_FORBIDDEN';
  END IF;
  IF TG_OP='UPDATE' THEN
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
      OR (NEW.authorized_at IS DISTINCT FROM OLD.authorized_at AND NOT (
        OLD.state='pending' AND NEW.state='active'
        AND OLD.authorized_at IS NULL AND NEW.authorized_at IS NOT NULL
      ))
    THEN
      RAISE EXCEPTION 'FEATURE_APPROVER_IMMUTABLE_IDENTITY';
    END IF;
    IF (OLD.state='active' AND NEW.state NOT IN ('suspended','revoked'))
      OR (OLD.state='suspended' AND NEW.state <> 'revoked')
      OR (OLD.state='pending' AND NEW.state NOT IN ('active','suspended','revoked'))
    THEN
      RAISE EXCEPTION 'FEATURE_APPROVER_INVALID_TRANSITION';
    END IF;
    IF NEW.state='active' AND NEW.authorized_at>now()+interval '5 seconds' THEN
      RAISE EXCEPTION 'FEATURE_APPROVER_FUTURE_AUTHORIZATION';
    END IF;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION katosync.feature_approver_audit_guard() FROM PUBLIC,anon,authenticated;

-- A revoked project is never silently reactivated in place. Its role and
-- key rows remain auditable, but no new issuer grants may be emitted.
CREATE FUNCTION katosync.feature_approval_project_transition_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'FEATURE_APPROVAL_PROJECT_DELETE_FORBIDDEN';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.state='revoked'
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.repository_full_name IS DISTINCT FROM OLD.repository_full_name
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR (NEW.approved_at IS DISTINCT FROM OLD.approved_at AND NOT (
        OLD.state='staged' AND NEW.state='active'
        AND OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL))
      OR (OLD.state='staged' AND NEW.state NOT IN ('active','suspended','revoked'))
      OR (OLD.state='active' AND NEW.state NOT IN ('suspended','revoked'))
      OR (OLD.state='suspended' AND NEW.state <> 'revoked')
    THEN
      RAISE EXCEPTION 'FEATURE_APPROVAL_PROJECT_INVALID_TRANSITION';
    END IF;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION katosync.feature_approval_project_transition_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER feature_approval_project_no_delete_or_reactivate
 BEFORE UPDATE OR DELETE ON katosync.feature_approval_projects
 FOR EACH ROW EXECUTE FUNCTION katosync.feature_approval_project_transition_guard();
