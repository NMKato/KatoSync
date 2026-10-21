-- All accounts, devices and approvals here are synthetic local test records.
-- Run after BOTH migration files in a disposable socket-only PostgreSQL instance.
SET ROLE service_role;

DO $$
DECLARE
  a record;
  b record;
  c record;
  account_id uuid := '11111111-1111-4111-8111-111111111111';
  device_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  device_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  task_a uuid := '11111111-aaaa-4111-8111-111111111111';
  task_b uuid := '22222222-bbbb-4222-8222-222222222222';
  approval_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
  approval_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
  approver uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  sha text := repeat('a', 40);
  rejected boolean;
BEGIN
  -- No immutable explicit approval record, no lease, regardless of ID claims.
  SELECT * INTO a FROM katosync_private.acquire_writer_lease(account_id,'approved-proj',device_a,task_a,approval_a,sha,60);
  IF a.acquired THEN RAISE EXCEPTION 'unsourced approval ID accepted'; END IF;

  INSERT INTO katosync_private.task_approvals
    (approval_id,account_id,project_id,device_id,task_id,expected_head,
     approved_by,proof_digest_sha256,capabilities,expires_at)
  VALUES
    (approval_a,account_id,'approved-proj',device_a,task_a,sha,approver,
     repeat('f',64),ARRAY['edit_worktree'],clock_timestamp()+interval '40 minutes'),
    (approval_b,account_id,'approved-proj',device_b,task_b,sha,approver,
     repeat('e',64),ARRAY['edit_worktree'],clock_timestamp()+interval '40 minutes');

  SELECT * INTO a FROM katosync_private.acquire_writer_lease(account_id,'approved-proj',device_a,task_b,approval_a,sha,60);
  IF a.acquired THEN RAISE EXCEPTION 'task impersonation accepted'; END IF;
  SELECT * INTO a FROM katosync_private.acquire_writer_lease(account_id,'approved-proj',device_b,task_a,approval_a,sha,60);
  IF a.acquired THEN RAISE EXCEPTION 'device impersonation accepted'; END IF;
  SELECT * INTO a FROM katosync_private.acquire_writer_lease(account_id,'approved-proj',device_a,task_a,approval_a,repeat('b',40),60);
  IF a.acquired THEN RAISE EXCEPTION 'different SHA accepted'; END IF;
  SELECT * INTO a FROM katosync_private.acquire_writer_lease(account_id,'elsewhere',device_a,task_a,approval_a,sha,60);
  IF a.acquired THEN RAISE EXCEPTION 'other project accepted'; END IF;
  SELECT * INTO a FROM katosync_private.acquire_writer_lease('99999999-9999-4999-8999-999999999999','approved-proj',device_a,task_a,approval_a,sha,60);
  IF a.acquired THEN RAISE EXCEPTION 'foreign account accepted'; END IF;

  SELECT * INTO a FROM katosync_private.acquire_writer_lease(account_id,'approved-proj',device_a,task_a,approval_a,sha,60);
  IF NOT a.acquired OR a.fencing_token != 1 THEN RAISE EXCEPTION 'approved task not granted'; END IF;
  IF NOT katosync_private.check_writer_lease(account_id,'approved-proj',device_a,task_a,approval_a,a.granted_lease_id,a.fencing_token,sha)
  THEN RAISE EXCEPTION 'valid approval incorrectly rejected'; END IF;
  SELECT * INTO b FROM katosync_private.acquire_writer_lease(account_id,'approved-proj',device_b,task_b,approval_b,sha,60);
  IF b.acquired THEN RAISE EXCEPTION 'second simultaneous writer accepted'; END IF;

  IF katosync_private.revoke_task_approval('99999999-9999-4999-8999-999999999999',approval_a)
  THEN RAISE EXCEPTION 'wrong-account revocation succeeded'; END IF;
  IF NOT katosync_private.renew_writer_lease(account_id,'approved-proj',device_a,task_a,approval_a,a.granted_lease_id,a.fencing_token,sha,60)
  THEN RAISE EXCEPTION 'valid renewal rejected'; END IF;
  IF NOT katosync_private.revoke_task_approval(account_id,approval_a)
  THEN RAISE EXCEPTION 'approved revocation rejected'; END IF;
  IF katosync_private.revoke_task_approval(account_id,approval_a)
  THEN RAISE EXCEPTION 'approval allowed repeat revocation'; END IF;
  IF katosync_private.check_writer_lease(account_id,'approved-proj',device_a,task_a,approval_a,a.granted_lease_id,a.fencing_token,sha)
     OR katosync_private.renew_writer_lease(account_id,'approved-proj',device_a,task_a,approval_a,a.granted_lease_id,a.fencing_token,sha,60)
  THEN RAISE EXCEPTION 'revoked approval still had live lease'; END IF;
  SELECT * INTO c FROM katosync_private.acquire_writer_lease(account_id,'approved-proj',device_a,task_a,approval_a,sha,60);
  IF c.acquired THEN RAISE EXCEPTION 'revoked approval reacquired'; END IF;
  SELECT * INTO c FROM katosync_private.acquire_writer_lease(account_id,'approved-proj',device_b,task_b,approval_b,sha,60);
  IF NOT c.acquired OR c.fencing_token != a.fencing_token+1 THEN
    RAISE EXCEPTION 'legitimate takeover after revocation failed';
  END IF;
  IF katosync_private.check_writer_lease(account_id,'approved-proj',device_a,task_a,approval_a,a.granted_lease_id,a.fencing_token,sha)
  THEN RAISE EXCEPTION 'stale lease check passed after takeover'; END IF;

  -- Immutability: a trusted DB caller cannot silently retarget an approval.
  rejected := false;
  BEGIN
    UPDATE katosync_private.task_approvals SET device_id=device_a WHERE approval_id=approval_b;
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'approval target mutated'; END IF;

  -- Expired approval rejected, even with a clean lease table for this project.
  INSERT INTO katosync_private.task_approvals
    (approval_id,account_id,project_id,device_id,task_id,expected_head,
     approved_by,proof_digest_sha256,capabilities,approved_at,expires_at)
  VALUES (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',account_id,'expired-proj',device_a,task_a,sha,
    approver,repeat('d',64),ARRAY['edit_worktree'],
    clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '20 minutes'
  );
  SELECT * INTO b FROM katosync_private.acquire_writer_lease(
    account_id,'expired-proj',device_a,task_a,'dddddddd-dddd-4ddd-8ddd-dddddddddddd',sha,60);
  IF b.acquired THEN RAISE EXCEPTION 'expired approval accepted'; END IF;

  RAISE NOTICE 'verified approval binding, revocation, immutable scope and fence tests PASS';
END $$;

RESET ROLE;

DO $$
BEGIN
  IF has_schema_privilege('anon','katosync_private','USAGE')
     OR has_table_privilege('authenticated','katosync_private.task_approvals','SELECT')
     OR has_table_privilege('anon','katosync_private.task_approvals','INSERT')
     OR has_function_privilege('authenticated','katosync_private.revoke_task_approval(uuid,uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'untrusted cloud role has approval access'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='katosync_private.task_approvals'::regclass)
  THEN RAISE EXCEPTION 'approval table RLS disabled'; END IF;
  RAISE NOTICE 'private approval ACL invariants PASS';
END $$;
