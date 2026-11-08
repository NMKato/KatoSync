-- NMKato Solutions: migration only, NOT DEPLOYED. One trial per canonical KATOOS user.
-- The grant is always provisioned by a separate authenticated billing service,
-- never by any Tauri client or unauthenticated HTTP endpoint.
CREATE TABLE IF NOT EXISTS katosync.mesh_trial_claims (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesh_trial_duration_bound CHECK (
    ends_at > started_at AND ends_at <= started_at + INTERVAL '336 hours'
  )
);

ALTER TABLE katosync.mesh_trial_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.mesh_trial_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON katosync.mesh_trial_claims TO authenticated;
GRANT SELECT, INSERT ON katosync.mesh_trial_claims TO service_role;
CREATE POLICY mesh_trial_owner_read
 ON katosync.mesh_trial_claims FOR SELECT TO authenticated
 USING (owner_user_id = (SELECT auth.uid()));

COMMENT ON TABLE katosync.mesh_trial_claims IS
 'One immutable 14-day Mesh trial claim per canonical user. Server-controlled, no client writes. Records survive trial-to-paid conversion.';
-- Granting a trial must occur in a single audited server transaction:
-- (1) verify KatoSync membership + KATOOS identity + no previous claim,
-- (2) INSERT immutable claim, (3) UPSERT mesh_owner_policy:
-- allowed_devices = 10, policy_expires_at = ends_at,
-- enrollment_mode = manual, passkey_enrollment_required = true.
-- Do not activate a trial via client-controlled claims or auto-pairing.
