-- NMKato Solutions: ONLY disposable PostgreSQL 17 test cluster.
\set ON_ERROR_STOP on
\ir mesh_inbox_edge_e2e_setup.sql
\ir ../../supabase/migrations/20261028204216_katosync_account_membership_admission.sql
\ir ../../release-candidates/stage4e/shared-k2s/20261109145621_katosync_shared_beta_failclosed_device_quota.sql

DO $pre$
BEGIN
 IF pg_catalog.inet_server_addr() IS NOT NULL
 OR current_setting('server_version_num')::integer<170000
 THEN RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_QA_NOT_DISPOSABLE'; END IF;
 IF (SELECT column_default FROM information_schema.columns
 WHERE table_schema='katosync' AND table_name='mesh_owner_policy'
 AND column_name='allowed_devices') IS NOT NULL
 THEN RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_HIDDEN_TWO_DEVICE_DEFAULT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE
   tgrelid='katosync.mesh_devices'::regclass
   AND tgname='katosync_mesh_device_identity_before_update' AND tgenabled='O')
 THEN RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_IDENTITY_GUARD_MISSING'; END IF;
 IF has_table_privilege('anon','katosync.mesh_devices','INSERT')
    OR has_table_privilege('authenticated','katosync.mesh_devices','INSERT')
 THEN RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_CLIENT_DML_ENABLED'; END IF;
END $pre$;
\echo KATOSYNC_SHARED_BETA_DEFAULT_OFF_AND_ROLES_PASS

INSERT INTO auth.users(id) VALUES
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333'),
 ('44444444-4444-4444-8444-444444444444');
INSERT INTO katosync.account_memberships(user_id,access_state,authorized_at)
VALUES
 ('11111111-1111-4111-8111-111111111111','active',clock_timestamp()),
 ('22222222-2222-4222-8222-222222222222','active',clock_timestamp()),
 ('44444444-4444-4444-8444-444444444444','active',clock_timestamp());
INSERT INTO katosync.mesh_owner_policy(owner_user_id,allowed_devices,policy_expires_at)
VALUES
 ('11111111-1111-4111-8111-111111111111',10,NULL),
 ('33333333-3333-4333-8333-333333333333',10,NULL),
 ('44444444-4444-4444-8444-444444444444',10,clock_timestamp()-interval '1 minute');
SET ROLE service_role;

DO $qa$
DECLARE owner1 uuid:='11111111-1111-4111-8111-111111111111';
DECLARE owner2 uuid:='22222222-2222-4222-8222-222222222222';
DECLARE owner3 uuid:='33333333-3333-4333-8333-333333333333';
DECLARE owner4 uuid:='44444444-4444-4444-8444-444444444444';
DECLARE id uuid;
BEGIN
 -- Free0/missing policy: a logged-in, active member still has 0 allowance.
 BEGIN
  INSERT INTO katosync.mesh_devices(owner_user_id,signing_public_key,
    fingerprint,display_name,platform_os)
  VALUES(owner2,repeat('K',43),repeat('11-',15)||'11','BLOCKED_FREE0','macos');
  RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_FREE0_UNEXPECTED_INSERT';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;

 -- No account membership: even 10 explicit slots never permit enrollment.
 BEGIN
  INSERT INTO katosync.mesh_devices(owner_user_id,signing_public_key,
    fingerprint,display_name,platform_os)
  VALUES(owner3,repeat('L',43),repeat('22-',15)||'22','BLOCKED_NO_MEMBER','macos');
  RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_NONMEMBER_UNEXPECTED_INSERT';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;

 -- Expired subscription/policy: 0 devices, fail-closed.
 BEGIN
  INSERT INTO katosync.mesh_devices(owner_user_id,signing_public_key,
    fingerprint,display_name,platform_os)
  VALUES(owner4,repeat('M',43),repeat('33-',15)||'33','BLOCKED_EXPIRED','macos');
  RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_EXPIRED_UNEXPECTED_INSERT';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;

 -- The single owner's explicit private beta allowance admits 10 total.
 INSERT INTO katosync.mesh_devices(owner_user_id,signing_public_key,
  fingerprint,display_name,platform_os)
 SELECT owner1,repeat(chr(64+n),43),
 upper(repeat(lpad(to_hex(n),2,'0')||'-',15)||
 lpad(to_hex(n),2,'0')),
 'SELF_BETA_DEVICE_'||n,'macos'
 FROM generate_series(1,10) n;
 IF (SELECT count(*) FROM katosync.mesh_devices WHERE owner_user_id=owner1)<>10
 THEN RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_PRO10_WRONG_DEVICE_TOTAL'; END IF;
 BEGIN
  INSERT INTO katosync.mesh_devices(owner_user_id,signing_public_key,
    fingerprint,display_name,platform_os)
  VALUES(owner1,repeat('Z',43),repeat('AB-',15)||'AB','BLOCKED_DEVICE_11','macos');
  RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_ELEVENTH_DEVICE_INSERTED';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;

 SELECT device_id INTO id FROM katosync.mesh_devices
 WHERE owner_user_id=owner1 ORDER BY created_at,device_id LIMIT 1;
 BEGIN
  UPDATE katosync.mesh_devices SET
    signing_public_key=repeat('X',43) WHERE device_id=id;
  RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_DEVICE_KEY_REBOUND';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
 UPDATE katosync.mesh_devices SET membership_state='revoked',
  revoked_at=clock_timestamp() WHERE device_id=id;
 BEGIN
  UPDATE katosync.mesh_devices SET membership_state='discovered',
    revoked_at=NULL WHERE device_id=id;
  RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_REVOKED_DEVICE_RESURRECTED';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
 IF (SELECT count(*) FROM katosync.mesh_devices)<>10
 THEN RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_DENIED_WRITES_LEAKED'; END IF;
END $qa$;
\echo KATOSYNC_SHARED_BETA_FREE0_EXPIRED_MEMBER_PRO10_IDENTITY_PASS

RESET ROLE;
DO $verify$
BEGIN
 IF (SELECT count(*) FROM katosync.mesh_devices
     WHERE membership_state='revoked')<>1
 THEN RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_DEVICE_REVOCATION_FAILED'; END IF;
 IF (SELECT count(*) FROM katosync.mesh_invites)<>0
 THEN RAISE EXCEPTION 'KATOSYNC_SHARED_BETA_UNEXPECTED_INVITATION_WRITE'; END IF;
END $verify$;
\echo KATOSYNC_SHARED_BETA_LOCAL_PG17_NO_KATOOS_DATA_PASS
