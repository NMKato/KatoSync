-- NMKato Solutions – account-specific KatoSync membership gate.
-- Same auth.users issuer as KATOOS, but an auth user is NOT automatically a
-- KatoSync member. No user self-enrollment, no token/header-based assignment.
CREATE TABLE katosync.account_memberships (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_state text NOT NULL DEFAULT 'pending'
    CHECK (access_state IN ('pending','active','suspended','revoked')),
  authorized_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT katosync_member_active_provenance CHECK (
    (access_state = 'active' AND authorized_at IS NOT NULL AND revoked_at IS NULL)
    OR (access_state IN ('pending','suspended') AND revoked_at IS NULL)
    OR (access_state = 'revoked' AND revoked_at IS NOT NULL)
  )
);
ALTER TABLE katosync.account_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.account_memberships FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON katosync.account_memberships TO service_role;
GRANT SELECT ON katosync.account_memberships TO authenticated;
CREATE POLICY katosync_membership_owner_read
  ON katosync.account_memberships FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
COMMENT ON TABLE katosync.account_memberships IS
  'Server-authorized KatoSync account allowlist. Valid Supabase/KATOOS Auth token alone never authorizes Mesh enrollment.';
