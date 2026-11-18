-- NMKato Solutions — only the runner's fresh local Unix socket PostgreSQL 17.
\set ON_ERROR_STOP on
\ir mesh_inbox_edge_e2e_setup.sql
\ir ../fixtures/migrations/20261031213900_mesh_pairing_relay_staged.sql
\ir ../../supabase/migrations/20261028204216_katosync_account_membership_admission.sql
BEGIN;
SELECT pg_catalog.set_config('katosync.qa_disposable','unix-socket-qa-only',true);
\ir ../../release-candidates/stage4e/qa_only_hardening_candidate.sql
\ir mesh_stage4e_atomic_write_overlay_qa.sql
COMMIT;
INSERT INTO katosync.account_memberships
 (user_id,access_state,authorized_at)
VALUES('11111111-1111-4111-8111-111111111111','active',clock_timestamp());
INSERT INTO katosync.mesh_owner_policy
 (owner_user_id,allowed_devices,enrollment_mode,policy_expires_at)
VALUES('11111111-1111-4111-8111-111111111111',10,'manual',
  clock_timestamp()+interval '5 minutes');
SET ROLE service_role;
INSERT INTO katosync.mesh_devices(
 owner_user_id,signing_public_key,fingerprint,display_name,platform_os
) VALUES
 ('11111111-1111-4111-8111-111111111111',repeat('A',43),
  repeat('AA-',15)||'AA','ATOMIC_M2','macos'),
 ('11111111-1111-4111-8111-111111111111',repeat('B',43),
  repeat('BB-',15)||'BB','ATOMIC_M3','macos');
-- Success proves the trigger actually admits a valid actor and owner policy.
INSERT INTO katosync.mesh_invites
 (owner_user_id,source_device_id,target_device_id,
  nonce,signed_offer,dispatch_signature,expires_at)
SELECT '11111111-1111-4111-8111-111111111111',a.device_id,b.device_id,
 repeat('N',43),'{"protocol":"katosync-mesh-pairing-v1"}',
 repeat('S',86),clock_timestamp()+interval '3 minutes'
FROM katosync.mesh_devices a, katosync.mesh_devices b
WHERE a.signing_public_key=repeat('A',43)
 AND b.signing_public_key=repeat('B',43);
INSERT INTO katosync.mesh_pairing_relay_reads
 (owner_user_id,device_id,nonce,expires_at)
SELECT owner_user_id,device_id,repeat('R',43),
 clock_timestamp()+interval '60 seconds'
FROM katosync.mesh_devices
WHERE signing_public_key=repeat('A',43);
UPDATE katosync.mesh_devices SET last_seen_at=clock_timestamp()
 WHERE signing_public_key=repeat('A',43);
DO $$
BEGIN
 IF (SELECT count(*) FROM katosync.mesh_invites)<>1
 OR (SELECT count(*) FROM katosync.mesh_pairing_relay_reads)<>1
 THEN RAISE EXCEPTION 'ATOMIC_QA_POSITIVE_WRITE_MISSING'; END IF;
END $$;
\echo KATOSYNC_STAGE4E_ATOMIC_POSITIVE_BOUND_WRITES_PASS
-- Move active owner to Free 0 by removing the only paid policy.
DELETE FROM katosync.mesh_owner_policy
 WHERE owner_user_id='11111111-1111-4111-8111-111111111111';
DO $$
DECLARE owner_id uuid:='11111111-1111-4111-8111-111111111111';
DECLARE a uuid;
DECLARE b uuid;
DECLARE inv uuid;
DECLARE msg text;
BEGIN
 SELECT device_id INTO a FROM katosync.mesh_devices
   WHERE owner_user_id=owner_id AND signing_public_key=repeat('A',43);
 SELECT device_id INTO b FROM katosync.mesh_devices
   WHERE owner_user_id=owner_id AND signing_public_key=repeat('B',43);
 SELECT request_id INTO inv FROM katosync.mesh_invites
   WHERE owner_user_id=owner_id LIMIT 1;
 -- Each sensitive write is denied by a DB trigger INSIDE its own transaction.
 BEGIN
  INSERT INTO katosync.mesh_invites(
   owner_user_id,source_device_id,target_device_id,nonce,
   signed_offer,dispatch_signature,expires_at)
  VALUES(owner_id,b,a,repeat('Q',43),'{}',repeat('S',86),
   clock_timestamp()+interval '2 minutes');
  RAISE EXCEPTION 'ATOMIC_QA_FREE_INVITE_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'ATOMIC_QA_INVITE_WRONG_DENIAL: %',msg; END IF;
 END;
 BEGIN
  INSERT INTO katosync.mesh_inbox_proofs(
   owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at)
  VALUES(owner_id,b,repeat('B',43),repeat('P',43),'accept',
   inv,clock_timestamp()+interval '60 seconds');
  RAISE EXCEPTION 'ATOMIC_QA_FREE_INBOX_PROOF_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'ATOMIC_QA_INBOX_WRONG_DENIAL: %',msg; END IF;
 END;
 BEGIN
  INSERT INTO katosync.mesh_pairing_relay_messages(
   owner_user_id,request_id,sender_device_id,recipient_device_id,
   kind,payload_b64,nonce,signature,expires_at)
  VALUES(owner_id,inv,a,b,'challenge',repeat('P',80),
   repeat('C',43),repeat('S',86),clock_timestamp()+interval '60 seconds');
  RAISE EXCEPTION 'ATOMIC_QA_FREE_RELAY_WRITE_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'ATOMIC_QA_RELAY_WRONG_DENIAL: %',msg; END IF;
 END;
 BEGIN
  INSERT INTO katosync.mesh_pairing_relay_reads(
   owner_user_id,device_id,nonce,expires_at)
  VALUES(owner_id,a,repeat('Z',43),clock_timestamp()+interval '60 seconds');
  RAISE EXCEPTION 'ATOMIC_QA_FREE_RELAY_READ_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'ATOMIC_QA_RELAY_READ_WRONG_DENIAL: %',msg; END IF;
 END;
 BEGIN
  INSERT INTO katosync.mesh_enrollment_challenges(
   owner_user_id,signing_public_key,nonce,expires_at)
  VALUES(owner_id,repeat('T',43),repeat('X',43),
   clock_timestamp()+interval '60 seconds');
  RAISE EXCEPTION 'ATOMIC_QA_FREE_CHALLENGE_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'ATOMIC_QA_CHALLENGE_WRONG_DENIAL: %',msg; END IF;
 END;
 BEGIN
  UPDATE katosync.mesh_devices SET last_seen_at=clock_timestamp()
    WHERE device_id=a;
  RAISE EXCEPTION 'ATOMIC_QA_FREE_HEARTBEAT_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'ATOMIC_QA_HEARTBEAT_WRONG_DENIAL: %',msg; END IF;
 END;
 BEGIN
  UPDATE katosync.mesh_invites SET state='accepted',resolved_at=clock_timestamp()
  WHERE request_id=inv;
  RAISE EXCEPTION 'ATOMIC_QA_FREE_ACCEPTED_INVITE';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'ATOMIC_QA_ACCEPT_WRONG_DENIAL: %',msg; END IF;
 END;
 -- Historical inbox decision trigger rejects cancellation: do not
 -- bypass its immutable behavior; flag lifecycle as a separate release gate.
 BEGIN
  UPDATE katosync.mesh_invites SET state='cancelled',resolved_at=clock_timestamp()
  WHERE request_id=inv;
  RAISE EXCEPTION 'ATOMIC_QA_UNREVIEWED_CANCELLATION_ENABLED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'ATOMIC_QA_CANCELLATION_WRONG_DENIAL: %',msg; END IF;
 END;
 -- Revocation of a device must NOT require an active subscription.
 UPDATE katosync.mesh_devices SET membership_state='revoked',revoked_at=clock_timestamp()
  WHERE device_id=b;
 IF NOT EXISTS(SELECT 1 FROM katosync.mesh_devices WHERE
    device_id=b AND membership_state='revoked' AND revoked_at IS NOT NULL)
 THEN RAISE EXCEPTION 'ATOMIC_QA_REVOCATION_BLOCKED'; END IF;
END $$;
\echo KATOSYNC_STAGE4E_ATOMIC_FREE0_WRITES_BLOCKED_DEVICE_REVOCATION_PASS
-- Restore a paid allowance but revoke active KatoSync membership itself.
INSERT INTO katosync.mesh_owner_policy
 (owner_user_id,allowed_devices,enrollment_mode,policy_expires_at)
VALUES('11111111-1111-4111-8111-111111111111',10,'manual',
 clock_timestamp()+interval '5 minutes');
UPDATE katosync.account_memberships
 SET access_state='revoked',revoked_at=clock_timestamp()
 WHERE user_id='11111111-1111-4111-8111-111111111111';
DO $$
DECLARE msg text;
BEGIN
 BEGIN
  INSERT INTO katosync.mesh_pairing_relay_reads(
   owner_user_id,device_id,nonce,expires_at)
  SELECT owner_user_id,device_id,repeat('Y',43),
    clock_timestamp()+interval '60 seconds'
  FROM katosync.mesh_devices WHERE signing_public_key=repeat('A',43);
  RAISE EXCEPTION 'ATOMIC_QA_REVOKED_MEMBER_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ACCOUNT_MEMBERSHIP_REQUIRED'
  THEN RAISE EXCEPTION 'ATOMIC_QA_MEMBER_WRONG_DENIAL: %',msg; END IF;
 END;
END $$;
\echo KATOSYNC_STAGE4E_ATOMIC_MEMBER_REVOCATION_BLOCKS_WRITE_PASS
-- Trial expires even though the row still claims max=10.
UPDATE katosync.account_memberships SET
  access_state='active',revoked_at=NULL,authorized_at=clock_timestamp()
WHERE user_id='11111111-1111-4111-8111-111111111111';
UPDATE katosync.mesh_owner_policy SET
  policy_expires_at=clock_timestamp()-interval '1 second'
WHERE owner_user_id='11111111-1111-4111-8111-111111111111';
DO $$
DECLARE msg text;
BEGIN
 BEGIN
  INSERT INTO katosync.mesh_pairing_relay_reads(
   owner_user_id,device_id,nonce,expires_at)
  SELECT owner_user_id,device_id,repeat('X',43),
    clock_timestamp()+interval '60 seconds'
  FROM katosync.mesh_devices WHERE signing_public_key=repeat('A',43);
  RAISE EXCEPTION 'ATOMIC_QA_EXPIRED_TRIAL_ALLOWED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ENTITLEMENT_REQUIRED'
  THEN RAISE EXCEPTION 'ATOMIC_QA_EXPIRED_WRONG_DENIAL: %',msg; END IF;
 END;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF has_function_privilege('anon',
  'katosync.mesh_atomic_write_entitlement_qa()','EXECUTE')
 OR has_function_privilege('authenticated',
  'katosync.mesh_atomic_write_entitlement_qa()','EXECUTE')
 OR has_table_privilege('anon','katosync.mesh_pairing_relay_reads','INSERT')
 OR has_table_privilege('authenticated','katosync.mesh_pairing_relay_reads','INSERT')
 THEN RAISE EXCEPTION 'ATOMIC_QA_CLIENT_OR_FUNCTION_EXECUTE_OPEN'; END IF;
END $$;
\echo KATOSYNC_STAGE4E_ATOMIC_GRANTS_FAIL_CLOSED_PASS
