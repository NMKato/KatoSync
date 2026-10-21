-- Run only in an EPHEMERAL, local PostgreSQL database initialized by the QA script.
-- Uses synthetic UUIDs; no cloud/project credentials, real accounts or data.
SET ROLE service_role;

DO $$
DECLARE
  a record;
  b record;
  c record;
  acct uuid := '11111111-1111-4111-8111-111111111111';
  device_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  device_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  task_a uuid := '11111111-aaaa-4111-8111-111111111111';
  task_b uuid := '22222222-bbbb-4222-8222-222222222222';
  approval uuid := '12345678-1234-4234-8234-123456781234';
  sha text := repeat('a', 40);
BEGIN
  SELECT * INTO a FROM katosync_private.acquire_writer_lease(acct,'synthetic-project',device_a,task_a,approval,sha,60);
  IF NOT a.acquired OR a.fencing_token <> 1 OR a.granted_lease_id IS NULL THEN
    RAISE EXCEPTION 'initial acquire invalid %', to_json(a);
  END IF;

  SELECT * INTO b FROM katosync_private.acquire_writer_lease(acct,'synthetic-project',device_b,task_b,approval,sha,60);
  IF b.acquired OR b.fencing_token IS NOT NULL THEN RAISE EXCEPTION 'active writer not blocked'; END IF;

  IF NOT katosync_private.check_writer_lease(acct,'synthetic-project',device_a,task_a,approval,a.granted_lease_id,a.fencing_token,sha)
    OR katosync_private.check_writer_lease(acct,'synthetic-project',device_b,task_a,approval,a.granted_lease_id,a.fencing_token,sha)
    OR katosync_private.check_writer_lease(acct,'synthetic-project',device_a,task_a,approval,a.granted_lease_id,99,sha)
    OR katosync_private.check_writer_lease(acct,'synthetic-project',device_a,task_a,approval,a.granted_lease_id,a.fencing_token,repeat('b',40))
  THEN RAISE EXCEPTION 'check accepted forged scope or rejected valid holder'; END IF;

  IF katosync_private.renew_writer_lease(acct,'synthetic-project',device_b,task_a,approval,a.granted_lease_id,a.fencing_token,sha,60)
    OR katosync_private.renew_writer_lease(acct,'synthetic-project',device_a,task_a,approval,a.granted_lease_id,a.fencing_token,sha,500)
    OR NOT katosync_private.renew_writer_lease(acct,'synthetic-project',device_a,task_a,approval,a.granted_lease_id,a.fencing_token,sha,60)
  THEN RAISE EXCEPTION 'renew authorization or ttl check failed'; END IF;

  IF katosync_private.release_writer_lease(acct,'synthetic-project',device_b,task_a,approval,a.granted_lease_id,a.fencing_token)
    OR NOT katosync_private.release_writer_lease(acct,'synthetic-project',device_a,task_a,approval,a.granted_lease_id,a.fencing_token)
  THEN RAISE EXCEPTION 'release ownership verification failed'; END IF;
  IF katosync_private.check_writer_lease(acct,'synthetic-project',device_a,task_a,approval,a.granted_lease_id,a.fencing_token,sha)
  THEN RAISE EXCEPTION 'released holder remained active'; END IF;

  SELECT * INTO c FROM katosync_private.acquire_writer_lease(acct,'synthetic-project',device_b,task_b,approval,sha,60);
  IF NOT c.acquired OR c.fencing_token <> a.fencing_token + 1 OR c.granted_lease_id = a.granted_lease_id THEN
    RAISE EXCEPTION 'fencing token was not advanced';
  END IF;
  IF katosync_private.release_writer_lease(acct,'synthetic-project',device_a,task_a,approval,a.granted_lease_id,a.fencing_token)
  THEN RAISE EXCEPTION 'stale writer released new lease'; END IF;

  -- Synthetic expiry to verify lost-lease behavior without waiting a minute.
  UPDATE katosync_private.writer_leases SET expires_at=clock_timestamp()-interval '1 second'
    WHERE account_id=acct AND project_id='synthetic-project';
  IF katosync_private.renew_writer_lease(acct,'synthetic-project',device_b,task_b,approval,c.granted_lease_id,c.fencing_token,sha,60)
  THEN RAISE EXCEPTION 'expired lease resurrected'; END IF;
  SELECT * INTO b FROM katosync_private.acquire_writer_lease(acct,'synthetic-project',device_a,task_a,approval,sha,60);
  IF NOT b.acquired OR b.fencing_token <> c.fencing_token+1 THEN
    RAISE EXCEPTION 'expired takeover or new fence invalid';
  END IF;
  IF katosync_private.check_writer_lease(acct,'synthetic-project',device_b,task_b,approval,c.granted_lease_id,c.fencing_token,sha)
  THEN RAISE EXCEPTION 'old device retained write capability'; END IF;

  SELECT * INTO c FROM katosync_private.acquire_writer_lease(acct,'invalid-project',device_a,task_a,approval,'not-a-sha',60);
  IF c.acquired THEN RAISE EXCEPTION 'invalid SHA accepted'; END IF;
  SELECT * INTO c FROM katosync_private.acquire_writer_lease(acct,'invalid-project',device_a,task_a,approval,sha,0);
  IF c.acquired THEN RAISE EXCEPTION 'invalid TTL accepted'; END IF;
  RAISE NOTICE 'writer lease sequential invariants PASS';
END $$;

RESET ROLE;

DO $$
BEGIN
  IF has_schema_privilege('anon','katosync_private','USAGE')
     OR has_schema_privilege('authenticated','katosync_private','USAGE')
     OR has_table_privilege('anon','katosync_private.writer_leases','SELECT')
     OR has_table_privilege('authenticated','katosync_private.writer_leases','UPDATE')
     OR has_function_privilege('anon','katosync_private.acquire_writer_lease(uuid,text,uuid,uuid,uuid,text,integer)','EXECUTE')
     OR has_function_privilege('authenticated','katosync_private.check_writer_lease(uuid,text,uuid,uuid,uuid,uuid,bigint,text)','EXECUTE')
  THEN RAISE EXCEPTION 'cloud client role has unauthorized lease access'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='katosync_private.writer_leases'::regclass)
  THEN RAISE EXCEPTION 'lease table RLS disabled'; END IF;
  RAISE NOTICE 'private schema and client ACL invariants PASS';
END $$;
