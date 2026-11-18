-- NMKato Solutions – KatoSync 4.0 Gate 7.
-- Privileged, one-time Ed25519 possession challenge; separate human approval.
-- Additive, zero seeded rows. Ordinary JWT login grants no feature-approval role.

CREATE TABLE katosync.feature_approval_reviewers (
  reviewer_uid uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','suspended','revoked')),
  authorized_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_reviewers_activation CHECK (
    (state='active' AND authorized_at IS NOT NULL AND revoked_at IS NULL)
    OR (state IN ('pending','suspended') AND revoked_at IS NULL)
    OR (state='revoked' AND revoked_at IS NOT NULL)
  )
);
ALTER TABLE katosync.feature_approval_reviewers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.feature_approval_reviewers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON katosync.feature_approval_reviewers TO service_role;

-- One pending revision per user/project. The review and owner key are fixed
-- by a separate administrator before any challenge is handed to the user.
CREATE UNIQUE INDEX feature_approver_one_pending_per_subject
  ON katosync.feature_approver_grants(project_id,subject_uid)
  WHERE state='pending';

-- Reviewer authorization is independent from the applicant and permanent.
CREATE FUNCTION katosync.feature_approval_reviewer_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'FEATURE_REVIEWER_DELETE_FORBIDDEN';
 END IF;
 IF OLD.state='revoked'
  OR NEW.reviewer_uid IS DISTINCT FROM OLD.reviewer_uid
  OR NEW.created_at IS DISTINCT FROM OLD.created_at
  OR (NEW.authorized_at IS DISTINCT FROM OLD.authorized_at AND NOT (
    OLD.state='pending' AND NEW.state='active'
    AND OLD.authorized_at IS NULL AND NEW.authorized_at IS NOT NULL))
  OR (OLD.state='pending' AND NEW.state NOT IN ('active','suspended','revoked'))
  OR (OLD.state='active' AND NEW.state NOT IN ('suspended','revoked'))
  OR (OLD.state='suspended' AND NEW.state <> 'revoked')
 THEN RAISE EXCEPTION 'FEATURE_REVIEWER_IMMUTABLE_AUTHORITY'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION katosync.feature_approval_reviewer_guard()
 FROM PUBLIC, anon, authenticated;
CREATE TRIGGER feature_approval_reviewer_no_reactivation
 BEFORE UPDATE OR DELETE ON katosync.feature_approval_reviewers
 FOR EACH ROW EXECUTE FUNCTION katosync.feature_approval_reviewer_guard();

CREATE TABLE katosync.feature_owner_challenges (
  challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES katosync.feature_approver_grants(grant_id)
    ON DELETE RESTRICT,
  project_id text NOT NULL REFERENCES katosync.feature_approval_projects(project_id)
    ON DELETE RESTRICT,
  subject_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  nonce text NOT NULL UNIQUE CHECK (length(nonce)=43 AND nonce ~ '^[A-Za-z0-9_-]+$'),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  canceled_at timestamptz,
  proof_signature text CHECK (
    proof_signature IS NULL OR
    (length(proof_signature)=86 AND proof_signature ~ '^[A-Za-z0-9_-]+$')
  ),
  proof_key_id text CHECK (
    proof_key_id IS NULL OR proof_key_id ~ '^ed25519-sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT feature_owner_challenge_lease CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes'
  ),
  CONSTRAINT feature_owner_challenge_outcome CHECK (
    (consumed_at IS NULL AND canceled_at IS NULL
     AND proof_signature IS NULL AND proof_key_id IS NULL)
    OR (consumed_at IS NOT NULL AND canceled_at IS NULL
        AND proof_signature IS NOT NULL AND proof_key_id IS NOT NULL)
    OR (consumed_at IS NULL AND canceled_at IS NOT NULL
        AND proof_signature IS NULL AND proof_key_id IS NULL)
  ),
  CONSTRAINT feature_owner_challenge_consumption_lease CHECK (
    consumed_at IS NULL OR
    (consumed_at >= issued_at AND consumed_at < expires_at)
  )
);
CREATE UNIQUE INDEX feature_owner_one_open_challenge
  ON katosync.feature_owner_challenges(grant_id)
  WHERE consumed_at IS NULL AND canceled_at IS NULL;
CREATE INDEX feature_owner_challenge_subject_lookup
  ON katosync.feature_owner_challenges(subject_uid,project_id,challenge_id);
ALTER TABLE katosync.feature_owner_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.feature_owner_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON katosync.feature_owner_challenges TO service_role;

CREATE FUNCTION katosync.feature_owner_challenge_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'FEATURE_OWNER_CHALLENGE_DELETE_FORBIDDEN';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.consumed_at IS NOT NULL OR OLD.canceled_at IS NOT NULL
    OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
    OR NEW.grant_id IS DISTINCT FROM OLD.grant_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.subject_uid IS DISTINCT FROM OLD.subject_uid
    OR NEW.nonce IS DISTINCT FROM OLD.nonce
    OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
  THEN RAISE EXCEPTION 'FEATURE_OWNER_CHALLENGE_IMMUTABLE'; END IF;
  IF (NEW.canceled_at IS NOT NULL
      AND (NEW.consumed_at IS NOT NULL OR NEW.proof_signature IS NOT NULL
        OR NEW.proof_key_id IS NOT NULL))
    OR (NEW.consumed_at IS NOT NULL AND
        (NEW.canceled_at IS NOT NULL OR NEW.proof_signature IS NULL OR
         NEW.proof_key_id IS NULL OR now() >= OLD.expires_at))
    OR (NEW.canceled_at IS NULL AND NEW.consumed_at IS NULL)
  THEN RAISE EXCEPTION 'FEATURE_OWNER_CHALLENGE_INVALID_TRANSITION'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION katosync.feature_owner_challenge_guard()
 FROM PUBLIC, anon, authenticated;
CREATE TRIGGER feature_owner_challenge_no_replay
 BEFORE UPDATE OR DELETE ON katosync.feature_owner_challenges
 FOR EACH ROW EXECUTE FUNCTION katosync.feature_owner_challenge_guard();

-- Atomic issue: lock the admin-provisioned pending grant, invalidate any
-- previous open nonce, then generate a new 32-byte nonce inside Postgres.
-- A self-registered key or a login without an admin pending grant fails.
CREATE FUNCTION katosync.feature_owner_challenge_issue(
  p_project_id text, p_subject_uid uuid
)
RETURNS TABLE (
  challenge_id uuid, project_id text, subject_uid uuid, nonce text,
  issued_at_ms bigint, expires_at_ms bigint
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
 v_grant uuid; v_id uuid; v_nonce text; v_issued timestamptz; v_expires timestamptz;
BEGIN
 SELECT g.grant_id INTO v_grant
 FROM katosync.feature_approver_grants g
 JOIN katosync.feature_approval_projects p ON p.project_id=g.project_id
 JOIN katosync.account_memberships m ON m.user_id=g.subject_uid
 WHERE g.project_id=p_project_id AND g.subject_uid=p_subject_uid
   AND g.state='pending' AND g.revoked_at IS NULL
   AND p.state='active' AND p.revoked_at IS NULL AND p.approved_at<=now()
   AND m.access_state='active' AND m.revoked_at IS NULL
   AND m.authorized_at<=now()
 FOR UPDATE OF g;
 IF v_grant IS NULL THEN
   RETURN;
 END IF;
 -- Bound repeated challenge calls, including previously consumed attempts.
 IF EXISTS (
    SELECT 1 FROM katosync.feature_owner_challenges
    WHERE grant_id=v_grant AND issued_at>now()-interval '30 seconds'
 ) THEN RETURN; END IF;
 UPDATE katosync.feature_owner_challenges c SET canceled_at=now()
 WHERE c.grant_id=v_grant AND c.consumed_at IS NULL AND c.canceled_at IS NULL;
 v_issued := clock_timestamp();
 v_expires := v_issued + interval '2 minutes';
 v_nonce := translate(
   rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_'
 );
 INSERT INTO katosync.feature_owner_challenges
  (grant_id,project_id,subject_uid,nonce,issued_at,expires_at)
 VALUES (v_grant,p_project_id,p_subject_uid,v_nonce,v_issued,v_expires)
 RETURNING feature_owner_challenges.challenge_id INTO v_id;
 RETURN QUERY SELECT v_id,p_project_id,p_subject_uid,v_nonce,
   floor(extract(epoch from v_issued)*1000)::bigint,
   floor(extract(epoch from v_expires)*1000)::bigint;
END $$;
REVOKE ALL ON FUNCTION katosync.feature_owner_challenge_issue(text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katosync.feature_owner_challenge_issue(text,uuid)
  TO service_role;

-- Backend verifies the Ed25519 signature BEFORE invoking this atomic RPC.
-- SQL requires the same immutable challenge, pending grant, and key binding.
-- No client EXECUTE permission; endpoint must not expose service-role secret.
CREATE FUNCTION katosync.feature_owner_challenge_consume(
 p_challenge_id uuid, p_project_id text, p_subject_uid uuid,
 p_key_id text, p_signature text
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $$
DECLARE v_grant uuid; v_count integer;
BEGIN
 IF p_signature IS NULL OR p_signature !~ '^[A-Za-z0-9_-]{86}$'
 OR p_key_id IS NULL OR p_key_id !~ '^ed25519-sha256:[0-9a-f]{64}$'
 THEN RETURN false; END IF;
 SELECT g.grant_id INTO v_grant
 FROM katosync.feature_approver_grants g
 JOIN katosync.feature_approval_projects p ON p.project_id=g.project_id
 JOIN katosync.account_memberships m ON m.user_id=g.subject_uid
 WHERE g.project_id=p_project_id AND g.subject_uid=p_subject_uid
 AND g.state='pending' AND g.owner_key_id=p_key_id AND g.revoked_at IS NULL
 AND p.state='active' AND p.revoked_at IS NULL
 AND m.access_state='active' AND m.revoked_at IS NULL
 FOR UPDATE OF g;
 IF v_grant IS NULL THEN RETURN false; END IF;
 UPDATE katosync.feature_owner_challenges c
 SET consumed_at=clock_timestamp(), proof_signature=p_signature,
     proof_key_id=p_key_id
 WHERE c.challenge_id=p_challenge_id AND c.grant_id=v_grant
   AND c.project_id=p_project_id AND c.subject_uid=p_subject_uid
   AND c.consumed_at IS NULL AND c.canceled_at IS NULL
   AND c.issued_at<=now() AND c.expires_at>clock_timestamp();
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count=1;
END $$;
REVOKE ALL ON FUNCTION katosync.feature_owner_challenge_consume(uuid,text,uuid,text,text)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katosync.feature_owner_challenge_consume(uuid,text,uuid,text,text)
 TO service_role;

-- Explicit reviewer allowlist; decision happens after proof consumption.
-- No API in the user-facing Edge Function may create an admin decision.
CREATE TABLE katosync.feature_owner_review_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL UNIQUE REFERENCES katosync.feature_approver_grants(grant_id)
    ON DELETE RESTRICT,
  challenge_id uuid NOT NULL UNIQUE REFERENCES katosync.feature_owner_challenges(challenge_id)
    ON DELETE RESTRICT,
  reviewer_uid uuid NOT NULL REFERENCES katosync.feature_approval_reviewers(reviewer_uid)
    ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 12 AND 1000),
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE katosync.feature_owner_review_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.feature_owner_review_decisions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON katosync.feature_owner_review_decisions TO service_role;

CREATE FUNCTION katosync.feature_owner_review_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $$
DECLARE v_count integer;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'FEATURE_OWNER_REVIEW_APPEND_ONLY';
 END IF;
 SELECT count(*) INTO v_count
 FROM katosync.feature_approver_grants g
 JOIN katosync.feature_owner_challenges c ON c.grant_id=g.grant_id
 JOIN katosync.feature_approval_reviewers r ON r.reviewer_uid=NEW.reviewer_uid
 JOIN katosync.feature_approval_projects p ON p.project_id=g.project_id
 WHERE g.grant_id=NEW.grant_id AND g.state='pending'
  AND NEW.challenge_id=c.challenge_id
  AND c.subject_uid=g.subject_uid AND c.project_id=g.project_id
  AND c.consumed_at IS NOT NULL AND c.proof_key_id=g.owner_key_id
  AND c.canceled_at IS NULL AND c.consumed_at>=now()-interval '24 hours'
  AND NEW.reviewer_uid<>g.subject_uid
  AND r.state='active' AND r.revoked_at IS NULL AND r.authorized_at<=now()
  AND p.state='active' AND p.revoked_at IS NULL
  AND NEW.reviewed_at>=c.consumed_at
  AND NEW.reviewed_at<=now()+interval '5 seconds';
 IF v_count<>1 THEN
  RAISE EXCEPTION 'FEATURE_OWNER_REVIEW_NOT_AUTHORIZED';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION katosync.feature_owner_review_guard()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER feature_owner_review_only_independent_admin
 BEFORE INSERT OR UPDATE OR DELETE ON katosync.feature_owner_review_decisions
 FOR EACH ROW EXECUTE FUNCTION katosync.feature_owner_review_guard();

-- Harden existing admin activation: neither possession nor login alone is
-- sufficient. A distinct, pre-authorized human reviewer must have signed
-- off AFTER a consumed proof. Retain all Gate 5 immutable/revocation checks.
CREATE OR REPLACE FUNCTION katosync.feature_approver_audit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $$
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
   JOIN katosync.feature_approval_projects p ON p.project_id=NEW.project_id
   JOIN katosync.account_memberships m ON m.user_id=NEW.subject_uid
   WHERE d.grant_id=NEW.grant_id AND d.decision='approved'
     AND c.grant_id=NEW.grant_id AND c.consumed_at IS NOT NULL
     AND c.proof_key_id=NEW.owner_key_id
     AND d.reviewer_uid<>NEW.subject_uid
     AND d.reviewed_at>=c.consumed_at AND d.reviewed_at>=now()-interval '24 hours'
     AND d.reviewed_at<=now()+interval '5 seconds'
     AND r.state='active' AND r.revoked_at IS NULL
     AND p.state='active' AND p.revoked_at IS NULL
     AND m.access_state='active' AND m.revoked_at IS NULL
  ) INTO v_valid;
  IF NOT v_valid THEN
   RAISE EXCEPTION 'FEATURE_OWNER_INDEPENDENT_APPROVAL_REQUIRED';
  END IF;
 END IF;
 IF NEW.state='active' AND (
   NEW.authorized_at IS NULL OR NEW.authorized_at>now()+interval '5 seconds'
 ) THEN RAISE EXCEPTION 'FEATURE_APPROVER_FUTURE_AUTHORIZATION'; END IF;
 NEW.updated_at:=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION katosync.feature_approver_audit_guard() FROM PUBLIC,anon,authenticated;

-- Nothing preauthorized. All five Gate7 changes remain fail-closed on
-- live databases until independent admin & owner actions are performed.
