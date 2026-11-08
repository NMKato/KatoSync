-- NMKato Solutions — disposable PG17; never run against remote databases.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
 AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
INSERT INTO auth.users(id) VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
\ir ../../supabase/migrations/20261028202403_katosync_mesh_owned_schema.sql
\ir ../../supabase/migrations/20261029211243_mesh_inbox_signed_send_guard.sql
INSERT INTO katosync.mesh_devices(owner_user_id,signing_public_key,fingerprint,display_name,platform_os) VALUES
 ('11111111-1111-4111-8111-111111111111',repeat('A',43),repeat('AA-',15)||'AA','m2','macos'),
 ('11111111-1111-4111-8111-111111111111',repeat('B',43),repeat('BB-',15)||'BB','m3','macos'),
 ('22222222-2222-4222-8222-222222222222',repeat('C',43),repeat('CC-',15)||'CC','other','linux');
DO $$
DECLARE a uuid; b uuid; other uuid; owner uuid='11111111-1111-4111-8111-111111111111';
BEGIN
 SELECT device_id INTO a FROM katosync.mesh_devices WHERE signing_public_key=repeat('A',43);
 SELECT device_id INTO b FROM katosync.mesh_devices WHERE signing_public_key=repeat('B',43);
 SELECT device_id INTO other FROM katosync.mesh_devices WHERE signing_public_key=repeat('C',43);
 INSERT INTO katosync.mesh_invites(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
 VALUES(owner,a,b,repeat('D',43),'{"protocol":"katosync-mesh-pairing-v1"}',repeat('X',86),now()+interval '3 minutes');
 -- Distinct nonce cannot create another pending A -> B.
 BEGIN
  INSERT INTO katosync.mesh_invites(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
  VALUES(owner,a,b,repeat('E',43),'{}',repeat('Y',86),now()+interval '3 minutes');
  RAISE EXCEPTION 'INBOX_QA_DUPLICATE_PENDING_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 -- Cross-account target is denied by FK owner binding.
 BEGIN
  INSERT INTO katosync.mesh_invites(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
  VALUES(owner,a,other,repeat('E',43),'{}',repeat('Y',86),now()+interval '3 minutes');
  RAISE EXCEPTION 'INBOX_QA_CROSS_OWNER_TARGET_ACCEPTED';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 -- Do not allow same signed offer / nonce even after an explicit resolution.
 UPDATE katosync.mesh_invites SET state='rejected',resolved_at=now() WHERE nonce=repeat('D',43);
 BEGIN
  INSERT INTO katosync.mesh_invites(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
  VALUES(owner,a,b,repeat('D',43),'{}',repeat('Y',86),now()+interval '3 minutes');
  RAISE EXCEPTION 'INBOX_QA_REPLAY_ACCEPTED';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 INSERT INTO katosync.mesh_invites(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
 VALUES(owner,a,b,repeat('E',43),'{}',repeat('Y',86),now()+interval '3 minutes');
 INSERT INTO katosync.mesh_invites(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
 VALUES(owner,b,a,repeat('F',43),'{}',repeat('Y',86),now()+interval '3 minutes');
 -- 4th insert even after resolution: owner rate limit 3 per minute.
 UPDATE katosync.mesh_invites SET state='rejected',resolved_at=now() WHERE nonce=repeat('E',43);
 BEGIN
  INSERT INTO katosync.mesh_invites(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
  VALUES(owner,a,b,repeat('G',43),'{}',repeat('Y',86),now()+interval '3 minutes');
  RAISE EXCEPTION 'INBOX_QA_RATE_LIMIT_BYPASSED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF (SELECT count(*) FROM katosync.mesh_invites)!=3 THEN
  RAISE EXCEPTION 'INBOX_QA_UNEXPECTED_ROW_COUNT';
 END IF;
END $$;
-- Authenticated clients retain owner-only reads, never INSERT/UPDATE.
DO $$
BEGIN
 IF has_table_privilege('authenticated','katosync.mesh_invites','INSERT')
 OR has_table_privilege('authenticated','katosync.mesh_invites','UPDATE')
 OR has_schema_privilege('anon','katosync','USAGE')
 THEN RAISE EXCEPTION 'INBOX_QA_PERMISSION_BREACH'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM katosync.mesh_invites) <> 0
 THEN RAISE EXCEPTION 'INBOX_QA_RLS_OTHER_OWNER_LEAK'; END IF;
 BEGIN
  INSERT INTO katosync.mesh_invites(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
  VALUES('11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',repeat('Z',43),'{}',repeat('Y',86),now()+interval '3 minutes');
  RAISE EXCEPTION 'INBOX_QA_CLIENT_WRITE_ENABLED';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
\echo MESH_INBOX_SEND_LOCAL_SQL_PASS
