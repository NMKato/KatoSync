-- KatoSync #76 synthetic private membership and durable one-shot challenge QA.
-- Apply ONLY to ephemeral Postgres test cluster after the three prior migrations.
SET ROLE service_role;

DO $$
DECLARE
  account uuid := '11111111-1111-4111-8111-111111111111';
  user_a uuid := '22222222-2222-4222-8222-222222222222';
  user_b uuid := '33333333-3333-4333-8333-333333333333';
  dev_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  dev_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  challenge uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  session_a uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  session_b uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  sig text := '-----BEGIN PUBLIC KEY-----' || repeat('A', 110) || '-----END PUBLIC KEY-----';
  n text := repeat('a',43);
  count_1 integer;
  rejected boolean := false;
BEGIN
  INSERT INTO katosync_private.project_memberships(account_id,project_id,user_id,role)
  VALUES (account,'project-a',user_a,'owner'),(account,'project-a',user_b,'viewer');

  INSERT INTO katosync_private.trusted_devices(account_id,device_id,owner_user_id,signing_public_key_pem,trusted)
  VALUES (account,dev_a,user_a,sig,true),(account,dev_b,user_b,sig,true);

  IF NOT EXISTS (SELECT 1 FROM katosync_private.project_memberships
      WHERE account_id=account AND user_id=user_a AND project_id='project-a'
      AND role='owner' AND revoked_at IS NULL)
  THEN RAISE EXCEPTION 'Owner should be authorized'; END IF;
  IF EXISTS (SELECT 1 FROM katosync_private.project_memberships
      WHERE account_id=account AND user_id=user_b AND project_id='project-a'
      AND role IN ('owner','approver') AND revoked_at IS NULL)
  THEN RAISE EXCEPTION 'Viewer obtained approval authority'; END IF;

  IF EXISTS (SELECT 1 FROM katosync_private.trusted_devices
      WHERE account_id=account AND device_id=dev_b AND owner_user_id=user_a
      AND trusted AND revoked_at IS NULL)
  THEN RAISE EXCEPTION 'Signer hijacked another account members device'; END IF;

  -- Immutable device keys and user ownership.
  rejected:=false;
  BEGIN
    UPDATE katosync_private.trusted_devices SET owner_user_id=user_a
     WHERE account_id=account AND device_id=dev_b;
  EXCEPTION WHEN raise_exception THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Device ownership mutable'; END IF;
  rejected:=false;
  BEGIN
    UPDATE katosync_private.trusted_devices SET signing_public_key_pem=sig||'x'
     WHERE account_id=account AND device_id=dev_b;
  EXCEPTION WHEN raise_exception THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Device signing key mutable'; END IF;

  INSERT INTO katosync_private.approval_challenges(
    challenge_id,nonce,account_id,project_id,task_id,
    executor_device_id,approver_device_id,expected_head,
    scope,user_id,session_id,expires_at
  ) VALUES (
    challenge,n,account,'project-a','ffffffff-ffff-4fff-8fff-ffffffffffff',
    dev_b,dev_a,repeat('a',40),'edit_worktree',user_a,session_a,
    clock_timestamp()+interval '60 seconds'
  );

  SELECT count(*) INTO count_1
    FROM katosync_private.consume_approval_challenge(challenge,user_a,session_b);
  IF count_1 <> 0 THEN RAISE EXCEPTION 'Foreign session consumed challenge'; END IF;
  SELECT count(*) INTO count_1
    FROM katosync_private.consume_approval_challenge(challenge,user_b,session_a);
  IF count_1 <> 0 THEN RAISE EXCEPTION 'Foreign user consumed challenge'; END IF;
  SELECT count(*) INTO count_1
    FROM katosync_private.consume_approval_challenge(challenge,user_a,session_a);
  IF count_1 <> 1 THEN RAISE EXCEPTION 'Valid one-time consume failed'; END IF;
  SELECT count(*) INTO count_1
    FROM katosync_private.consume_approval_challenge(challenge,user_a,session_a);
  IF count_1 <> 0 THEN RAISE EXCEPTION 'Replayed challenge consumed twice'; END IF;

  rejected:=false;
  BEGIN
    UPDATE katosync_private.approval_challenges SET consumed_at=NULL WHERE challenge_id=challenge;
  EXCEPTION WHEN raise_exception THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Consumed challenge reset permitted'; END IF;
  rejected:=false;
  BEGIN
    UPDATE katosync_private.approval_challenges SET user_id=user_b WHERE challenge_id=challenge;
  EXCEPTION WHEN raise_exception THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Challenge actor retarget permitted'; END IF;

  -- Expired challenge cannot be consumed.
  INSERT INTO katosync_private.approval_challenges(
    challenge_id,nonce,account_id,project_id,task_id,
    executor_device_id,approver_device_id,expected_head,
    scope,user_id,session_id,created_at,expires_at
  ) VALUES (
    '99999999-9999-4999-8999-999999999999', repeat('z',43),
    account,'project-a','ffffffff-ffff-4fff-8fff-ffffffffffff',
    dev_b,dev_a,repeat('a',40),'edit_worktree',user_a,session_a,
    clock_timestamp()-interval '80 seconds',clock_timestamp()-interval '30 seconds'
  );
  SELECT count(*) INTO count_1 FROM katosync_private.consume_approval_challenge(
    '99999999-9999-4999-8999-999999999999',user_a,session_a
  );
  IF count_1<>0 THEN RAISE EXCEPTION 'Expired challenge accepted'; END IF;

  -- One-way revocation for membership and devices.
  UPDATE katosync_private.project_memberships
    SET revoked_at=clock_timestamp() WHERE account_id=account AND user_id=user_a;
  rejected:=false;
  BEGIN
    UPDATE katosync_private.project_memberships SET revoked_at=NULL
    WHERE account_id=account AND user_id=user_a;
  EXCEPTION WHEN raise_exception THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Membership revoked then unrevoked'; END IF;

  UPDATE katosync_private.trusted_devices SET revoked_at=clock_timestamp(), trusted=false
  WHERE account_id=account AND device_id=dev_a;
  rejected:=false;
  BEGIN
    UPDATE katosync_private.trusted_devices SET revoked_at=NULL, trusted=true
    WHERE account_id=account AND device_id=dev_a;
  EXCEPTION WHEN raise_exception THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Device revoked then reenabled'; END IF;

  RAISE NOTICE 'membership, device ownership, revocation, session scope and one-time consume PASS';
END $$;

RESET ROLE;
DO $$
BEGIN
 IF has_schema_privilege('anon','katosync_private','USAGE')
 OR has_table_privilege('authenticated','katosync_private.approval_challenges','SELECT')
 OR has_table_privilege('anon','katosync_private.trusted_devices','UPDATE')
 OR has_table_privilege('authenticated','katosync_private.project_memberships','INSERT')
 OR has_function_privilege('anon','katosync_private.consume_approval_challenge(uuid,uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Private membership/challenge ACL exposed to clients'; END IF;
 RAISE NOTICE 'private schema ACL PASS';
END $$;
