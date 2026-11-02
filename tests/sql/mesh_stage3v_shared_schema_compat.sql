-- NMKato Solutions · Stage 3V shared KATOOS/KatoSync schema compatibility.
-- Disposable PostgreSQL socket only; do not run on KATOOS production.
\set ON_ERROR_STOP on
\ir mesh_pairing_relay_qa.sql
-- The production baseline also includes this separately applied membership migration.
\ir ../../supabase/migrations/20261028204216_katosync_account_membership_admission.sql
INSERT INTO auth.users(id) VALUES('22222222-2222-4222-8222-222222222222');
INSERT INTO katosync.account_memberships(user_id,access_state,authorized_at)
VALUES ('11111111-1111-4111-8111-111111111111','active',now()),
       ('22222222-2222-4222-8222-222222222222','pending',null);
INSERT INTO katosync.mesh_devices(owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
VALUES ('22222222-2222-4222-8222-222222222222',repeat('C',43),repeat('CC-',15)||'CC','unrelated QA','linux');
DO $$
DECLARE total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='katosync' AND c.relkind IN ('r','p');
 IF total <> 8 THEN RAISE EXCEPTION 'STAGE3V_SCHEMA_TABLE_COUNT_DRIFT: %',total; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='katosync' AND c.relkind IN ('r','p')
    AND NOT c.relrowsecurity)
 THEN RAISE EXCEPTION 'STAGE3V_TABLE_WITHOUT_RLS'; END IF;
 IF has_schema_privilege('anon','katosync','USAGE')
 OR has_table_privilege('anon','katosync.mesh_invites','SELECT')
 OR has_table_privilege('authenticated','katosync.mesh_invites','SELECT')
 OR has_table_privilege('authenticated','katosync.mesh_inbox_proofs','SELECT')
 OR has_table_privilege('authenticated','katosync.mesh_pairing_relay_messages','SELECT')
 OR has_table_privilege('authenticated','katosync.mesh_pairing_relay_reads','SELECT')
 THEN RAISE EXCEPTION 'STAGE3V_INBOX_OR_RELAY_LEAK'; END IF;
 IF NOT has_table_privilege('authenticated','katosync.account_memberships','SELECT')
 OR NOT has_table_privilege('authenticated','katosync.mesh_devices','SELECT')
 OR NOT has_table_privilege('service_role','katosync.mesh_pairing_relay_messages','INSERT')
 THEN RAISE EXCEPTION 'STAGE3V_EXISTING_AUTH_OR_SERVER_GRANT_BROKEN'; END IF;
END $$;

-- Actual role+RLS behavior, not just catalog permissions.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM katosync.account_memberships) <> 1
 OR (SELECT access_state FROM katosync.account_memberships LIMIT 1)<>'active'
 OR (SELECT count(*) FROM katosync.mesh_devices)<>2
 THEN RAISE EXCEPTION 'STAGE3V_OWNER_PREVIEW_BROKEN'; END IF;
 BEGIN
  PERFORM count(*) FROM katosync.mesh_invites;
  RAISE EXCEPTION 'STAGE3V_OWNER_DIRECT_INBOX_READ_OPEN';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE katosync.account_memberships SET access_state='revoked';
  RAISE EXCEPTION 'STAGE3V_CLIENT_SELF_PROMOTION_OR_REVOKE_OPEN';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM katosync.account_memberships)<>1
 OR (SELECT access_state FROM katosync.account_memberships LIMIT 1)<>'pending'
 OR (SELECT count(*) FROM katosync.mesh_devices)<>1
 THEN RAISE EXCEPTION 'STAGE3V_OTHER_OWNER_LEAK'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM katosync.account_memberships)<>0
 OR (SELECT count(*) FROM katosync.mesh_devices)<>0
 THEN RAISE EXCEPTION 'STAGE3V_UNAUTHORIZED_OWNER_LEAK'; END IF;
END $$;
RESET ROLE;
\echo STAGE3V_SHARED_KATOOS_SCHEMA_COMPAT_PASS
