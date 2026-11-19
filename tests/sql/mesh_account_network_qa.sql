-- Created by NMKato Solutions
-- Ausschliesslich wegwerfbare lokale PG17-Instanz. Keine Cloud, keine realen Nutzer.
\set ON_ERROR_STOP on
\ir mesh_inbox_edge_e2e_setup.sql
\ir ../fixtures/migrations/20261031213900_mesh_pairing_relay_staged.sql
\ir ../../supabase/migrations/20261028204216_katosync_account_membership_admission.sql
CREATE TABLE auth.sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
 oauth_client_id uuid, not_after timestamptz
);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;
\ir ../../supabase/migrations/20261119094236_mesh_account_network_control.sql

INSERT INTO auth.users(id) VALUES
 ('99999999-9999-4999-8999-999999999999'),
 ('77777777-7777-4777-8777-777777777777');
INSERT INTO katosync.account_memberships(user_id,access_state,authorized_at)
 SELECT id,'active',clock_timestamp() FROM auth.users;
INSERT INTO auth.sessions(id,user_id) VALUES
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111'),
 ('44444444-4444-4444-8444-444444444444','99999999-9999-4999-8999-999999999999'),
 ('55555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777');
INSERT INTO katosync.mesh_owner_policy(owner_user_id,allowed_devices)
 SELECT id,10 FROM auth.users;
INSERT INTO katosync.mesh_devices(device_id,owner_user_id,signing_public_key,fingerprint,display_name,platform_os,membership_state,revoked_at)
VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',repeat('A',43),repeat('AA-',15)||'AA','A','macos','discovered',NULL),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111',repeat('B',43),repeat('BB-',15)||'BB','B','macos','trusted',NULL),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','99999999-9999-4999-8999-999999999999',repeat('C',43),repeat('CC-',15)||'CC','C','macos','discovered',NULL),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111',repeat('D',43),repeat('DD-',15)||'DD','D','macos','revoked',clock_timestamp()),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111',repeat('E',43),repeat('EE-',15)||'EE','E','macos','pending',NULL),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','77777777-7777-4777-8777-777777777777',repeat('F',43),repeat('FF-',15)||'FF','F','macos','discovered',NULL),
 ('abababab-abab-4bab-8bab-abababababab','77777777-7777-4777-8777-777777777777',repeat('G',43),repeat('AB-',15)||'AB','G','macos','trusted',NULL);

CREATE FUNCTION pg_temp.assert(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(query text, expected_code text, expected_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught_code text; caught_message text;
BEGIN
 BEGIN
  EXECUTE query;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS caught_code = RETURNED_SQLSTATE, caught_message = MESSAGE_TEXT;
 END;
 IF caught_code IS DISTINCT FROM expected_code OR (expected_message IS NOT NULL AND caught_message IS DISTINCT FROM expected_message)
 THEN RAISE EXCEPTION 'Expected %/%, got %/%',expected_code,expected_message,caught_code,caught_message; END IF;
END $$;
CREATE FUNCTION pg_temp.claims(owner_id text, session_id text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('iss','https://xbnnlyyxiilklsygxcof.supabase.co/auth/v1',
  'aud','authenticated','role','authenticated','sub',owner_id,'session_id',session_id,
  'is_anonymous',false,'exp',floor(extract(epoch FROM clock_timestamp()))::bigint+3600)
$$;

SELECT pg_temp.assert((SELECT relrowsecurity FROM pg_class WHERE oid='katosync.mesh_account_network'::regclass),'RLS enabled');
SELECT pg_temp.assert(NOT has_table_privilege('authenticated','katosync.mesh_account_network','INSERT,UPDATE,DELETE'),'no direct DML');
SELECT pg_temp.assert(NOT has_function_privilege('anon','katosync.mesh_account_network_get()','EXECUTE'),'anon denied');
SELECT pg_temp.assert(NOT has_function_privilege('service_role','katosync.mesh_account_network_set_primary(uuid,bigint)','EXECUTE'),'service caller denied');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','katosync_mesh_private.require_native_network_owner()','EXECUTE'),'internal actor helper not exposed');
SELECT pg_temp.assert((SELECT bool_and(NOT p.prosecdef) FROM pg_proc p WHERE p.oid IN
 ('katosync.mesh_account_network_get()'::regprocedure,'katosync.mesh_account_network_set_primary(uuid,bigint)'::regprocedure)),'wrappers are invoker');
SELECT pg_temp.assert((SELECT bool_and(p.proconfig=ARRAY['search_path=pg_catalog']) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='katosync_mesh_private'),'fixed search path');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('request.jwt.claims',pg_temp.claims('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333')::text,false);
SELECT pg_temp.assert(katosync.mesh_account_network_get()->>'accountRevision'='0','empty revision0');
SELECT pg_temp.assert(katosync.mesh_account_network_get()->'mainDeviceId'='null'::jsonb,'empty main');
SELECT pg_temp.assert((SELECT count(*)=0 FROM katosync.mesh_account_network),'GET creates no row');
SELECT pg_temp.expect_error($q$INSERT INTO katosync.mesh_account_network VALUES('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,now())$q$,'42501');
SELECT pg_temp.assert(katosync.mesh_account_network_set_primary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0)->>'accountRevision'='1','setter immediately returns revision1');
SELECT pg_temp.assert(katosync.mesh_account_network_set_primary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1)->>'accountRevision'='1','same correct selection idempotent');
SELECT pg_temp.expect_error($q$SELECT katosync.mesh_account_network_set_primary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0)$q$,'40001','MESH_ACCOUNT_REVISION_CONFLICT');
SELECT pg_temp.expect_error($q$SELECT katosync.mesh_account_network_set_primary('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NULL)$q$,'22023','MESH_ACCOUNT_INVALID_SELECTION');
SELECT pg_temp.expect_error($q$SELECT katosync.mesh_account_network_set_primary(NULL,1)$q$,'22023','MESH_ACCOUNT_INVALID_SELECTION');
SELECT pg_temp.expect_error($q$SELECT katosync.mesh_account_network_set_primary('cccccccc-cccc-4ccc-8ccc-cccccccccccc',1)$q$,'42501','MESH_ACCOUNT_DEVICE_UNAVAILABLE');
SELECT pg_temp.expect_error($q$SELECT katosync.mesh_account_network_set_primary('dddddddd-dddd-4ddd-8ddd-dddddddddddd',1)$q$,'42501','MESH_ACCOUNT_DEVICE_UNAVAILABLE');
SELECT pg_temp.expect_error($q$SELECT katosync.mesh_account_network_set_primary('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',1)$q$,'42501','MESH_ACCOUNT_DEVICE_UNAVAILABLE');
SELECT pg_temp.expect_error($q$SELECT katosync.mesh_account_network_set_primary('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',9007199254740992)$q$,'22023','MESH_ACCOUNT_INVALID_SELECTION');
SELECT pg_temp.assert(katosync.mesh_account_network_set_primary('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1)->>'accountRevision'='2','trusted selection immediately returns new revision');

DO $$
DECLARE baseline jsonb := pg_temp.claims('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333'); invalid_claims jsonb;
BEGIN
 FOR invalid_claims IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  baseline||jsonb_build_object('client_id','bad-client'), baseline||jsonb_build_object('oauth_client_id','bad-client'),
  baseline||jsonb_build_object('azp','bad-client'), baseline||jsonb_build_object('is_anonymous',true), baseline-'is_anonymous',
  baseline||jsonb_build_object('is_anonymous','false'::text), baseline||jsonb_build_object('is_anonymous',NULL),
  baseline||jsonb_build_object('session_id','44444444-4444-4444-8444-444444444444'),
  baseline||jsonb_build_object('session_id','00000000-0000-0000-0000-000000000000'),
  baseline||jsonb_build_object('exp',1), baseline||jsonb_build_object('iss','https://foreign.invalid/auth/v1'),
  baseline||jsonb_build_object('aud','foreign'), baseline||jsonb_build_object('role','service_role')
 )) LOOP
  PERFORM set_config('request.jwt.claims',invalid_claims::text,false);
  PERFORM pg_temp.expect_error('SELECT katosync.mesh_account_network_get()','42501','MESH_ACCOUNT_LOGIN_REQUIRED');
 END LOOP;
 PERFORM set_config('request.jwt.claims',baseline::text,false);
END $$;
RESET ROLE;
UPDATE auth.sessions SET oauth_client_id='66666666-6666-4666-8666-666666666666' WHERE id='33333333-3333-4333-8333-333333333333';
SET ROLE authenticated;
SELECT pg_temp.expect_error('SELECT katosync.mesh_account_network_get()','42501','MESH_ACCOUNT_LOGIN_REQUIRED');
RESET ROLE;
UPDATE auth.sessions SET oauth_client_id=NULL,not_after=clock_timestamp()-interval '1 second' WHERE id='33333333-3333-4333-8333-333333333333';
SET ROLE authenticated;
SELECT pg_temp.expect_error('SELECT katosync.mesh_account_network_get()','42501','MESH_ACCOUNT_LOGIN_REQUIRED');
RESET ROLE;
UPDATE auth.sessions SET not_after=NULL WHERE id='33333333-3333-4333-8333-333333333333';
UPDATE katosync.account_memberships SET access_state='suspended' WHERE user_id='11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
SELECT pg_temp.expect_error('SELECT katosync.mesh_account_network_get()','42501','MESH_ACCOUNT_MEMBERSHIP_REQUIRED');
RESET ROLE;
UPDATE katosync.account_memberships SET access_state='active' WHERE user_id='11111111-1111-4111-8111-111111111111';
UPDATE katosync.mesh_devices SET membership_state='revoked',revoked_at=clock_timestamp() WHERE device_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SET ROLE authenticated;
SELECT pg_temp.assert(katosync.mesh_account_network_get()->>'mainDeviceId'='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','revoked main remains selected');
SELECT pg_temp.assert(katosync.mesh_account_network_get()->>'mainDeviceAvailable'='false','revoked main unavailable');
SELECT pg_temp.assert(katosync.mesh_account_network_get()->>'accountRevision'='2','revoke is not implicit reselection');
SELECT pg_temp.expect_error($q$SELECT katosync.mesh_account_network_set_primary('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',2)$q$,'42501','MESH_ACCOUNT_DEVICE_UNAVAILABLE');
SELECT pg_temp.assert(katosync.mesh_account_network_set_primary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2)->>'accountRevision'='3','explicit replacement only');
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
SELECT set_config('request.jwt.claims',pg_temp.claims('99999999-9999-4999-8999-999999999999','44444444-4444-4444-8444-444444444444')::text,false);
SELECT pg_temp.assert((SELECT count(*)=0 FROM katosync.mesh_account_network),'foreign topology hidden by RLS');
SELECT pg_temp.assert(katosync.mesh_account_network_get()->>'accountRevision'='0','foreign account has separate empty state');
SELECT pg_temp.expect_error($q$SELECT katosync.mesh_account_network_set_primary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0)$q$,'42501','MESH_ACCOUNT_DEVICE_UNAVAILABLE');
RESET ROLE;
SELECT pg_temp.expect_error($q$INSERT INTO katosync.mesh_account_network VALUES('99999999-9999-4999-8999-999999999999','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,now())$q$,'23503');
SELECT pg_temp.assert((SELECT count(*)=1 FROM katosync.mesh_account_network),'no failed selection creates rows');

-- Tatsachlicher DB-Pfad mit trusted-Quelle/-Ziel: Proof, Annahme und Relay.
UPDATE katosync.mesh_devices SET membership_state='trusted',revoked_at=NULL WHERE device_id IN
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
SET ROLE service_role;
INSERT INTO katosync.mesh_invites(request_id,owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
VALUES('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('N',43),
 jsonb_build_object('publicKey',repeat('A',43),'protocol','katosync-mesh-pairing-v1'),repeat('S',86),now()+interval '3 minutes');
SELECT pg_temp.expect_error($q$INSERT INTO katosync.mesh_inbox_proofs(owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at)
 VALUES('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('Z',43),repeat('W',43),'accept','88888888-8888-4888-8888-888888888888',now()+interval '60 seconds')$q$,
 '23514','KATOSYNC_MESH_PROOF_RECIPIENT_KEY_MISMATCH');
INSERT INTO katosync.mesh_inbox_proofs(owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at)
VALUES('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('B',43),repeat('R',43),'accept','88888888-8888-4888-8888-888888888888',now()+interval '60 seconds');
UPDATE katosync.mesh_invites i SET state='accepted',resolved_at=now(),resolution_proof_id=p.proof_id
 FROM katosync.mesh_inbox_proofs p WHERE p.request_id=i.request_id;
INSERT INTO katosync.mesh_pairing_relay_messages(owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at)
VALUES('11111111-1111-4111-8111-111111111111','88888888-8888-4888-8888-888888888888',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','challenge',repeat('P',80),repeat('Q',43),repeat('X',86),now()+interval '2 minutes');
UPDATE katosync.mesh_devices SET membership_state='revoked',revoked_at=now() WHERE device_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT pg_temp.expect_error($q$INSERT INTO katosync.mesh_pairing_relay_messages(owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at)
 VALUES('11111111-1111-4111-8111-111111111111','88888888-8888-4888-8888-888888888888',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','response',repeat('P',80),repeat('T',43),repeat('X',86),now()+interval '2 minutes')$q$,
 '23514','KATOSYNC_MESH_RELAY_NOT_ELIGIBLE');
UPDATE katosync.mesh_devices SET membership_state='trusted',revoked_at=NULL WHERE device_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO katosync.mesh_pairing_relay_messages(owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at)
VALUES('11111111-1111-4111-8111-111111111111','88888888-8888-4888-8888-888888888888',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','response',repeat('P',80),repeat('T',43),repeat('X',86),now()+interval '2 minutes');
RESET ROLE;
SELECT pg_temp.assert((SELECT count(*)=2 FROM katosync.mesh_pairing_relay_messages),'trusted bidirectional relay with unchanged gates');
SELECT pg_temp.assert((SELECT count(*)=0 FROM katosync.mesh_account_network WHERE owner_user_id='77777777-7777-4777-8777-777777777777'),'race owner starts empty');
\echo MESH_ACCOUNT_NETWORK_SQL_ASSERTIONS_PASS
