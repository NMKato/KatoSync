-- NMKato Solutions — disposable PostgreSQL 17 only. Never execute on live DB.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
INSERT INTO auth.users(id) VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
\ir ../../supabase/migrations/20261028202403_katosync_mesh_owned_schema.sql
\ir ../../supabase/migrations/20261029211243_mesh_inbox_signed_send_guard.sql
\ir ../../supabase/migrations/20261030072543_mesh_recipient_signed_inbox_atomic_decisions.sql

INSERT INTO katosync.mesh_devices(owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
VALUES
 ('11111111-1111-4111-8111-111111111111',repeat('A',43),repeat('AA-',15)||'AA','sender','macos'),
 ('11111111-1111-4111-8111-111111111111',repeat('B',43),repeat('BB-',15)||'BB','recipient','macos'),
 ('22222222-2222-4222-8222-222222222222',repeat('C',43),repeat('CC-',15)||'CC','foreign','linux');
INSERT INTO katosync.mesh_invites
(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
SELECT '11111111-1111-4111-8111-111111111111',
 (SELECT device_id FROM katosync.mesh_devices WHERE signing_public_key=repeat('A',43)),
 (SELECT device_id FROM katosync.mesh_devices WHERE signing_public_key=repeat('B',43)),
 repeat('D',43),'{"protocol":"katosync-mesh-pairing-v1"}',repeat('X',86),
 now()+interval '3 minutes';

DO $$
BEGIN
 IF has_table_privilege('authenticated','katosync.mesh_invites','SELECT')
    OR has_table_privilege('authenticated','katosync.mesh_invites','UPDATE')
    OR has_table_privilege('authenticated','katosync.mesh_inbox_proofs','SELECT')
    OR has_table_privilege('authenticated','katosync.mesh_inbox_proofs','INSERT')
    OR has_schema_privilege('anon','katosync','USAGE')
 THEN RAISE EXCEPTION 'MESH_INBOX_DIRECT_CLIENT_ACCESS_OPEN'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
   ON n.oid=c.relnamespace WHERE c.relname='mesh_inbox_proofs'
   AND n.nspname='katosync' AND c.relrowsecurity)
 THEN RAISE EXCEPTION 'MESH_INBOX_PROOF_RLS_MISSING'; END IF;
END $$;

-- Exercise the actual table-level nonce uniqueness, not only the Edge verifier.
INSERT INTO katosync.mesh_inbox_proofs
 (owner_user_id,device_id,nonce,action,request_id,expires_at)
SELECT owner_user_id,device_id,repeat('E',43),'list',
 '00000000-0000-4000-8000-000000000000',now()+interval '60 seconds'
FROM katosync.mesh_devices WHERE signing_public_key=repeat('B',43);
DO $$
DECLARE owner uuid='11111111-1111-4111-8111-111111111111';
DECLARE recipient uuid;
BEGIN
 SELECT device_id INTO recipient FROM katosync.mesh_devices WHERE signing_public_key=repeat('B',43);
 BEGIN
  INSERT INTO katosync.mesh_inbox_proofs
   (owner_user_id,device_id,nonce,action,request_id,expires_at)
  VALUES(owner,recipient,repeat('E',43),'accept',gen_random_uuid(),now()+interval '60 seconds');
  RAISE EXCEPTION 'MESH_INBOX_NONCE_REPLAY_OPEN';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 -- Fill to 12 proofs in the rate-window. A 13th MUST be rejected.
 FOR i IN 1..11 LOOP
  INSERT INTO katosync.mesh_inbox_proofs
   (owner_user_id,device_id,nonce,action,request_id,expires_at)
  VALUES(owner,recipient,repeat(chr(69+i),43),'list',
   '00000000-0000-4000-8000-000000000000',now()+interval '60 seconds');
 END LOOP;
 BEGIN
  INSERT INTO katosync.mesh_inbox_proofs
   (owner_user_id,device_id,nonce,action,request_id,expires_at)
  VALUES(owner,recipient,repeat('Z',43),'list',
   '00000000-0000-4000-8000-000000000000',now()+interval '60 seconds');
  RAISE EXCEPTION 'MESH_INBOX_RATE_LIMIT_OPEN';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM katosync.mesh_invites;
  RAISE EXCEPTION 'MESH_INBOX_CLIENT_READ_OPEN';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO katosync.mesh_inbox_proofs
   (owner_user_id,device_id,nonce,action,request_id,expires_at)
  VALUES('11111111-1111-4111-8111-111111111111',
   gen_random_uuid(),repeat('Z',43),'list',
   '00000000-0000-4000-8000-000000000000',now()+interval '60 seconds');
  RAISE EXCEPTION 'MESH_INBOX_CLIENT_PROOF_WRITE_OPEN';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SET ROLE service_role;
DO $$
DECLARE row_id uuid;
BEGIN
 SELECT request_id INTO row_id FROM katosync.mesh_invites LIMIT 1;
 -- Atomic pending -> accepted transition.
 UPDATE katosync.mesh_invites SET state='accepted',resolved_at=now()
 WHERE request_id=row_id AND state='pending' AND expires_at>now();
 IF (SELECT state FROM katosync.mesh_invites WHERE request_id=row_id)<>'accepted'
 THEN RAISE EXCEPTION 'MESH_INBOX_ACCEPT_FAILED'; END IF;
 -- No second decision, even from service-role.
 BEGIN
  UPDATE katosync.mesh_invites SET state='rejected',resolved_at=now()
  WHERE request_id=row_id;
  RAISE EXCEPTION 'MESH_INBOX_DOUBLE_RESOLUTION_OPEN';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 -- Revoke a source while a second invitation is pending. It must not be accepted.
 INSERT INTO katosync.mesh_invites
 (owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
 SELECT owner_user_id,source_device_id,target_device_id,
    repeat('F',43),'{}',repeat('X',86),now()+interval '2 minutes'
 FROM katosync.mesh_invites WHERE request_id=row_id;
 UPDATE katosync.mesh_devices SET membership_state='revoked',revoked_at=now()
 WHERE device_id=(SELECT source_device_id FROM katosync.mesh_invites WHERE request_id=row_id);
 BEGIN
  UPDATE katosync.mesh_invites SET state='accepted',resolved_at=now()
  WHERE nonce=repeat('F',43) AND state='pending';
  RAISE EXCEPTION 'MESH_INBOX_REVOKED_SOURCE_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 -- Reject target or payload mutation after resolution.
 BEGIN
  UPDATE katosync.mesh_invites SET signed_offer='{"compromised":true}'::jsonb
  WHERE request_id=row_id;
  RAISE EXCEPTION 'MESH_INBOX_PAYLOAD_MUTATION_OPEN';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
RESET ROLE;
\echo MESH_INBOX_RECIPIENT_ATOMIC_AND_RLS_PASS
