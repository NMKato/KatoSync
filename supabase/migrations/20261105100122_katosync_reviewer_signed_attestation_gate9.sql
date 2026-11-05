-- NMKato Solutions — KatoSync 4.0 Gate 9.
-- Independently Ed25519-signed HUMAN reviewer decisions. Zero pre-seeded users.
-- PostgreSQL cannot independently verify Ed25519: verified by KATOOS Edge,
-- with signed material persisted for later native independent revalidation.
-- The privileged service_role still forms a high-trust boundary.

CREATE TABLE katosync.feature_reviewer_signing_keys (
  reviewer_key_id text PRIMARY KEY CHECK (
    reviewer_key_id ~ '^ed25519-sha256:[0-9a-f]{64}$'
  ),
  reviewer_uid uuid NOT NULL REFERENCES katosync.feature_approval_reviewers(reviewer_uid)
    ON DELETE RESTRICT,
  public_key text NOT NULL CHECK (
    length(public_key)=43 AND public_key ~ '^[A-Za-z0-9_-]+$'
  ),
  key_revision bigint NOT NULL CHECK (key_revision BETWEEN 1 AND 9007199254740991),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','active','suspended','revoked')),
  approved_at timestamptz,
  revoked_at timestamptz,
  admin_evidence_ref text NOT NULL CHECK (
    length(trim(admin_evidence_ref)) BETWEEN 20 AND 200
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviewer_key_activation CHECK (
    (state='active' AND approved_at IS NOT NULL AND revoked_at IS NULL)
    OR (state IN ('pending','suspended') AND revoked_at IS NULL)
    OR (state='revoked' AND revoked_at IS NOT NULL)
  ),
  UNIQUE(reviewer_uid,key_revision)
);
CREATE UNIQUE INDEX feature_reviewer_one_active_signing_key
 ON katosync.feature_reviewer_signing_keys(reviewer_uid) WHERE state='active';
CREATE INDEX feature_reviewer_keys_subject
 ON katosync.feature_reviewer_signing_keys(reviewer_uid,state);
ALTER TABLE katosync.feature_reviewer_signing_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.feature_reviewer_signing_keys FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON katosync.feature_reviewer_signing_keys TO service_role;

CREATE FUNCTION katosync.feature_reviewer_signing_key_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog AS $function$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'REVIEWER_KEY_DELETE_FORBIDDEN';
 END IF;
 IF OLD.state='revoked'
  OR NEW.reviewer_key_id IS DISTINCT FROM OLD.reviewer_key_id
  OR NEW.reviewer_uid IS DISTINCT FROM OLD.reviewer_uid
  OR NEW.public_key IS DISTINCT FROM OLD.public_key
  OR NEW.key_revision IS DISTINCT FROM OLD.key_revision
  OR NEW.admin_evidence_ref IS DISTINCT FROM OLD.admin_evidence_ref
  OR NEW.created_at IS DISTINCT FROM OLD.created_at
  OR (NEW.approved_at IS DISTINCT FROM OLD.approved_at AND NOT(
    OLD.state='pending' AND NEW.state='active'
    AND OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL
  ))
  OR (OLD.state='pending' AND NEW.state NOT IN ('active','suspended','revoked'))
  OR (OLD.state='active' AND NEW.state NOT IN ('suspended','revoked'))
  OR (OLD.state='suspended' AND NEW.state<>'revoked')
 THEN RAISE EXCEPTION 'REVIEWER_KEY_IMMUTABLE'; END IF;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION katosync.feature_reviewer_signing_key_guard()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER feature_reviewer_signing_key_no_reissue
 BEFORE UPDATE OR DELETE ON katosync.feature_reviewer_signing_keys
 FOR EACH ROW EXECUTE FUNCTION katosync.feature_reviewer_signing_key_guard();

-- Live Gate7 review rows = zero, so NOT NULL is safe.
-- Preserve independent signatures for off-server re-verification, no client access.
ALTER TABLE katosync.feature_owner_review_decisions
 ADD COLUMN reviewer_key_id text NOT NULL
 REFERENCES katosync.feature_reviewer_signing_keys(reviewer_key_id) ON DELETE RESTRICT,
 ADD COLUMN reviewer_key_revision bigint NOT NULL
 CHECK (reviewer_key_revision BETWEEN 1 AND 9007199254740991),
 ADD COLUMN reviewer_public_key text NOT NULL CHECK (
    length(reviewer_public_key)=43 AND reviewer_public_key ~ '^[A-Za-z0-9_-]+$'
 ),
 ADD COLUMN owner_key_id text NOT NULL
 CHECK(owner_key_id ~ '^ed25519-sha256:[0-9a-f]{64}$'),
 ADD COLUMN grant_revision bigint NOT NULL CHECK (
    grant_revision BETWEEN 1 AND 9007199254740991
 ),
 ADD COLUMN project_id text NOT NULL,
 ADD COLUMN subject_uid uuid NOT NULL,
 ADD COLUMN signed_at_ms bigint NOT NULL CHECK (signed_at_ms > 0),
 ADD COLUMN reviewer_signature text NOT NULL CHECK (
    length(reviewer_signature)=86 AND reviewer_signature ~ '^[A-Za-z0-9_-]+$'
 ),
 ADD COLUMN attestation_protocol text NOT NULL DEFAULT
    'katosync.owner-independent-review/v1'
    CHECK(attestation_protocol='katosync.owner-independent-review/v1');
CREATE UNIQUE INDEX feature_owner_review_signature_no_replay
 ON katosync.feature_owner_review_decisions(reviewer_key_id,reviewer_signature);

-- Upgrade existing reviewer decision trigger: an unsigned grant review can
-- never be inserted. Reviewer UID, active key and grant revision are matched
-- against independently admin-provisioned tables.
CREATE OR REPLACE FUNCTION katosync.feature_owner_review_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $function$
DECLARE v_count integer;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'FEATURE_OWNER_REVIEW_APPEND_ONLY';
 END IF;
 SELECT count(*) INTO v_count
 FROM katosync.feature_approver_grants g
 JOIN katosync.feature_owner_challenges c ON c.grant_id=g.grant_id
 JOIN katosync.feature_approval_reviewers r ON r.reviewer_uid=NEW.reviewer_uid
 JOIN katosync.feature_reviewer_signing_keys k
   ON k.reviewer_uid=r.reviewer_uid
   AND k.reviewer_key_id=NEW.reviewer_key_id
 JOIN katosync.feature_approval_projects p ON p.project_id=g.project_id
 JOIN katosync.account_memberships m ON m.user_id=NEW.reviewer_uid
 WHERE g.grant_id=NEW.grant_id AND g.state='pending'
  AND NEW.challenge_id=c.challenge_id
  AND c.subject_uid=g.subject_uid AND c.project_id=g.project_id
  AND c.consumed_at IS NOT NULL AND c.proof_key_id=g.owner_key_id
  AND c.canceled_at IS NULL AND c.consumed_at>=now()-interval '24 hours'
  AND NEW.reviewer_uid<>g.subject_uid
  AND r.state='active' AND r.revoked_at IS NULL AND r.authorized_at<=now()
  AND k.state='active' AND k.revoked_at IS NULL AND k.approved_at<=now()
  AND k.key_revision=NEW.reviewer_key_revision
  AND k.public_key=NEW.reviewer_public_key
  AND p.state='active' AND p.revoked_at IS NULL
  AND m.access_state='active' AND m.revoked_at IS NULL AND m.authorized_at<=now()
  AND NEW.project_id=g.project_id AND NEW.subject_uid=g.subject_uid
  AND NEW.owner_key_id=g.owner_key_id
  AND NEW.grant_revision=g.grant_revision
  AND NEW.signed_at_ms BETWEEN
     floor(extract(epoch from c.consumed_at)*1000)::bigint
     AND floor(extract(epoch from now()+interval '5 seconds')*1000)::bigint
  AND NEW.reviewed_at>=c.consumed_at
  AND NEW.reviewed_at<=now()+interval '5 seconds';
 IF v_count<>1 THEN
  RAISE EXCEPTION 'FEATURE_OWNER_SIGNED_REVIEW_NOT_AUTHORIZED';
 END IF;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION katosync.feature_owner_review_guard()
 FROM PUBLIC,anon,authenticated;

-- One trusted atomic write API, called only after server-side KATOOS identity
-- AND Ed25519 reviewer signature validation. Does NOT activate the grant.
CREATE FUNCTION katosync.feature_owner_review_submit(
 p_grant_id uuid,p_challenge_id uuid,p_reviewer_uid uuid,
 p_decision text,p_reason text,p_key_id text,
 p_signature text,p_signed_at_ms bigint
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $function$
DECLARE
 v_grant katosync.feature_approver_grants%ROWTYPE;
 v_key katosync.feature_reviewer_signing_keys%ROWTYPE;
 v_decision uuid;
BEGIN
 IF p_decision NOT IN ('approved','rejected')
   OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 12 AND 1000
   OR p_signature IS NULL OR p_signature !~ '^[A-Za-z0-9_-]{86}$'
   OR p_signed_at_ms IS NULL OR p_signed_at_ms<=0
 THEN RETURN NULL; END IF;
 SELECT * INTO v_grant FROM katosync.feature_approver_grants
 WHERE grant_id=p_grant_id AND state='pending'
 FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO v_key FROM katosync.feature_reviewer_signing_keys
 WHERE reviewer_uid=p_reviewer_uid AND reviewer_key_id=p_key_id
  AND state='active' AND revoked_at IS NULL
 FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO katosync.feature_owner_review_decisions(
   grant_id,challenge_id,reviewer_uid,decision,reason,
   reviewer_key_id,reviewer_key_revision,reviewer_public_key,
   owner_key_id,grant_revision,project_id,subject_uid,
   signed_at_ms,reviewer_signature
 ) VALUES(
   p_grant_id,p_challenge_id,p_reviewer_uid,p_decision,p_reason,
   v_key.reviewer_key_id,v_key.key_revision,v_key.public_key,
   v_grant.owner_key_id,v_grant.grant_revision,v_grant.project_id,
   v_grant.subject_uid,p_signed_at_ms,p_signature
 ) RETURNING decision_id INTO v_decision;
 RETURN v_decision;
END $function$;
REVOKE ALL ON FUNCTION katosync.feature_owner_review_submit(
 uuid,uuid,uuid,text,text,text,text,bigint
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.feature_owner_review_submit(
 uuid,uuid,uuid,text,text,text,text,bigint
) TO service_role;

-- Only a validly persisted, distinct reviewer-key-bound decision can
-- authorize the *separate* admin activation transition. This SQL guard
-- is defense in depth; independent Ed25519 verification remains essential.
CREATE OR REPLACE FUNCTION katosync.feature_approver_audit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $function$
DECLARE v_valid boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FEATURE_APPROVER_DELETE_FORBIDDEN'; END IF;
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
   AND OLD.authorized_at IS NULL AND NEW.authorized_at IS NOT NULL))
  OR (OLD.state='active' AND NEW.state NOT IN ('suspended','revoked'))
  OR (OLD.state='suspended' AND NEW.state<>'revoked')
  OR (OLD.state='pending' AND NEW.state NOT IN ('active','suspended','revoked'))
 THEN RAISE EXCEPTION 'FEATURE_APPROVER_IMMUTABLE_IDENTITY'; END IF;
 IF OLD.state='pending' AND NEW.state='active' THEN
  SELECT EXISTS (
   SELECT 1 FROM katosync.feature_owner_review_decisions d
   JOIN katosync.feature_owner_challenges c ON c.challenge_id=d.challenge_id
   JOIN katosync.feature_approval_reviewers r ON r.reviewer_uid=d.reviewer_uid
   JOIN katosync.feature_reviewer_signing_keys k
    ON k.reviewer_key_id=d.reviewer_key_id AND k.reviewer_uid=d.reviewer_uid
   JOIN katosync.feature_approval_projects p ON p.project_id=NEW.project_id
   JOIN katosync.account_memberships m ON m.user_id=NEW.subject_uid
   WHERE d.grant_id=NEW.grant_id AND d.decision='approved'
     AND c.grant_id=NEW.grant_id AND c.consumed_at IS NOT NULL
     AND c.proof_key_id=NEW.owner_key_id
     AND d.reviewer_uid<>NEW.subject_uid
     AND d.owner_key_id=NEW.owner_key_id
     AND d.grant_revision=NEW.grant_revision
     AND d.project_id=NEW.project_id
     AND d.subject_uid=NEW.subject_uid
     AND d.reviewer_key_revision=k.key_revision
     AND d.reviewer_public_key=k.public_key
     AND d.reviewed_at>=c.consumed_at AND d.reviewed_at>=now()-interval '24 hours'
     AND d.reviewed_at<=now()+interval '5 seconds'
     AND r.state='active' AND r.revoked_at IS NULL
     AND k.state='active' AND k.revoked_at IS NULL
     AND p.state='active' AND p.revoked_at IS NULL
     AND m.access_state='active' AND m.revoked_at IS NULL
  ) INTO v_valid;
  IF NOT v_valid THEN
   RAISE EXCEPTION 'FEATURE_OWNER_SIGNED_APPROVAL_REQUIRED';
  END IF;
 END IF;
 IF NEW.state='active' AND (
   NEW.authorized_at IS NULL OR NEW.authorized_at>now()+interval '5 seconds'
 ) THEN RAISE EXCEPTION 'FEATURE_APPROVER_FUTURE_AUTHORIZATION'; END IF;
 NEW.updated_at:=now();
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION katosync.feature_approver_audit_guard()
 FROM PUBLIC,anon,authenticated;

-- Migration does not register projects, reviewers or signing keys.
-- Existing grants can only be activated with new independent proof.
