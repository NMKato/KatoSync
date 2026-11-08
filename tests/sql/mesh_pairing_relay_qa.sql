-- NMKato Solutions — hermetic PostgreSQL 17 socket-only QA; never on production.
\set ON_ERROR_STOP on
\ir mesh_inbox_edge_e2e_setup.sql
\ir ../../supabase/migrations/20261031213900_mesh_pairing_relay_staged.sql

INSERT INTO katosync.mesh_devices(owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
VALUES
 ('11111111-1111-4111-8111-111111111111',repeat('A',43),repeat('AA-',15)||'AA','M2 QA','macos'),
 ('11111111-1111-4111-8111-111111111111',repeat('B',43),repeat('BB-',15)||'BB','M3 QA','macos');

INSERT INTO katosync.mesh_invites(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
SELECT '11111111-1111-4111-8111-111111111111',
 a.device_id,b.device_id,repeat('N',43),
 jsonb_build_object('publicKey',repeat('A',43),'protocol','katosync-mesh-pairing-v1'),
 repeat('S',86),now()+interval '3 minutes'
FROM katosync.mesh_devices a CROSS JOIN katosync.mesh_devices b
WHERE a.signing_public_key=repeat('A',43) AND b.signing_public_key=repeat('B',43);

INSERT INTO katosync.mesh_inbox_proofs(owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at)
SELECT '11111111-1111-4111-8111-111111111111',i.target_device_id,
 repeat('B',43),repeat('R',43),'accept',i.request_id,now()+interval '60 seconds'
FROM katosync.mesh_invites i;

UPDATE katosync.mesh_invites i
SET state='accepted',resolved_at=now(),resolution_proof_id=p.proof_id
FROM katosync.mesh_inbox_proofs p
WHERE p.request_id=i.request_id AND p.action='accept';

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM katosync.mesh_invites WHERE state='accepted')
 THEN RAISE EXCEPTION 'RELAY_FIXTURE_ACCEPTANCE_FAILED'; END IF;
 IF has_table_privilege('authenticated','katosync.mesh_pairing_relay_messages','SELECT')
 OR has_table_privilege('authenticated','katosync.mesh_pairing_relay_messages','INSERT')
 OR has_table_privilege('authenticated','katosync.mesh_pairing_relay_reads','SELECT')
 OR has_table_privilege('authenticated','katosync.mesh_pairing_relay_reads','INSERT')
 OR has_schema_privilege('anon','katosync','USAGE')
 THEN RAISE EXCEPTION 'RELAY_CLIENT_ACCESS_OPEN'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
    ON n.oid=c.relnamespace WHERE c.relname='mesh_pairing_relay_messages'
    AND n.nspname='katosync' AND c.relrowsecurity)
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
    ON n.oid=c.relnamespace WHERE c.relname='mesh_pairing_relay_reads'
    AND n.nspname='katosync' AND c.relrowsecurity)
 THEN RAISE EXCEPTION 'RELAY_RLS_MISSING'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM katosync.mesh_pairing_relay_messages;
  RAISE EXCEPTION 'RELAY_AUTHENTICATED_READ_OPEN';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO katosync.mesh_pairing_relay_reads(owner_user_id,device_id,nonce,expires_at)
   SELECT owner_user_id,device_id,repeat('Z',43),now()+interval '60 seconds'
   FROM katosync.mesh_devices LIMIT 1;
  RAISE EXCEPTION 'RELAY_AUTHENTICATED_PROOF_INSERT_OPEN';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SET ROLE service_role;
DO $$
DECLARE i katosync.mesh_invites%ROWTYPE;
DECLARE c uuid;
BEGIN
 SELECT * INTO i FROM katosync.mesh_invites WHERE state='accepted' LIMIT 1;
 -- Must reject a response until an accepted invitation's challenge is present.
 BEGIN
  INSERT INTO katosync.mesh_pairing_relay_messages
   (owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at)
  VALUES (i.owner_user_id,i.request_id,i.source_device_id,i.target_device_id,
   'response',repeat('P',80),repeat('D',43),repeat('X',86),now()+interval '2 minutes');
  RAISE EXCEPTION 'RELAY_RESPONSE_WITHOUT_CHALLENGE_OPEN';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 INSERT INTO katosync.mesh_pairing_relay_messages
   (owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at)
 VALUES(i.owner_user_id,i.request_id,i.target_device_id,i.source_device_id,
   'challenge',repeat('P',80),repeat('C',43),repeat('X',86),now()+interval '2 minutes')
 RETURNING message_id INTO c;

 BEGIN
  INSERT INTO katosync.mesh_pairing_relay_messages
   (owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at)
  VALUES (i.owner_user_id,i.request_id,i.target_device_id,i.source_device_id,
   'challenge',repeat('P',80),repeat('E',43),repeat('X',86),now()+interval '2 minutes');
  RAISE EXCEPTION 'RELAY_DUPLICATE_CHALLENGE_OPEN';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO katosync.mesh_pairing_relay_messages
   (owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at)
  VALUES (i.owner_user_id,i.request_id,i.target_device_id,i.source_device_id,
   'response',repeat('P',80),repeat('E',43),repeat('X',86),now()+interval '2 minutes');
  RAISE EXCEPTION 'RELAY_WRONG_DIRECTION_OPEN';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 UPDATE katosync.mesh_devices SET membership_state='revoked',revoked_at=now()
 WHERE device_id=i.target_device_id;
 BEGIN
  INSERT INTO katosync.mesh_pairing_relay_messages
   (owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at)
  VALUES (i.owner_user_id,i.request_id,i.source_device_id,i.target_device_id,
   'response',repeat('P',80),repeat('F',43),repeat('X',86),now()+interval '2 minutes');
  RAISE EXCEPTION 'RELAY_REVOKED_DEVICE_ALLOWED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 UPDATE katosync.mesh_devices SET membership_state='discovered',revoked_at=NULL
 WHERE device_id=i.target_device_id;

 INSERT INTO katosync.mesh_pairing_relay_messages
  (owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at)
 VALUES (i.owner_user_id,i.request_id,i.source_device_id,i.target_device_id,
   'response',repeat('P',80),repeat('F',43),repeat('X',86),now()+interval '2 minutes');

 IF (SELECT count(*) FROM katosync.mesh_pairing_relay_messages WHERE request_id=i.request_id)<>2
 THEN RAISE EXCEPTION 'RELAY_BIDIRECTIONAL_INSERT_MISSING'; END IF;
END $$;

DO $$
DECLARE owner uuid='11111111-1111-4111-8111-111111111111';
DECLARE d uuid;
BEGIN
 SELECT device_id INTO d FROM katosync.mesh_devices WHERE signing_public_key=repeat('A',43);
 INSERT INTO katosync.mesh_pairing_relay_reads(owner_user_id,device_id,nonce,expires_at)
 VALUES(owner,d,repeat('0',43),now()+interval '60 seconds');
 BEGIN
  INSERT INTO katosync.mesh_pairing_relay_reads(owner_user_id,device_id,nonce,expires_at)
  VALUES(owner,d,repeat('0',43),now()+interval '60 seconds');
  RAISE EXCEPTION 'RELAY_REPLAY_NONCE_ALLOWED';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 FOR n IN 1..11 LOOP
  INSERT INTO katosync.mesh_pairing_relay_reads(owner_user_id,device_id,nonce,expires_at)
  VALUES(owner,d,repeat(chr(65+n),43),now()+interval '60 seconds');
 END LOOP;
 BEGIN
  INSERT INTO katosync.mesh_pairing_relay_reads(owner_user_id,device_id,nonce,expires_at)
  VALUES(owner,d,repeat('Z',43),now()+interval '60 seconds');
  RAISE EXCEPTION 'RELAY_RATE_LIMIT_OPEN';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
RESET ROLE;
\echo MESH_RELAY_LOCAL_SQL_SECURITY_PASS
