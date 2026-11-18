-- NMKato Solutions: ONLY local PG17, isolated UNIX socket, NO DEPLOY.
\set ON_ERROR_STOP on
\ir mesh_inbox_edge_e2e_setup.sql
\ir ../fixtures/migrations/20261031213900_mesh_pairing_relay_staged.sql
\ir ../../supabase/migrations/20261028204216_katosync_account_membership_admission.sql
BEGIN;
SELECT pg_catalog.set_config('katosync.qa_disposable','unix-socket-qa-only',true);
\ir ../../release-candidates/stage4e/qa_only_hardening_candidate.sql
\ir mesh_stage4e_atomic_write_overlay_qa.sql
\i :inbox_lifecycle_overlay
COMMIT;
INSERT INTO auth.users(id) VALUES('22222222-2222-4222-8222-222222222222');
INSERT INTO katosync.account_memberships(user_id,access_state,authorized_at)
 VALUES('11111111-1111-4111-8111-111111111111','active',clock_timestamp()),
       ('22222222-2222-4222-8222-222222222222','active',clock_timestamp());
SET ROLE service_role;
INSERT INTO katosync.mesh_owner_policy
(owner_user_id,allowed_devices,enrollment_mode,policy_expires_at)
 VALUES('11111111-1111-4111-8111-111111111111',10,'manual',clock_timestamp()+interval '5 minutes'),
       ('22222222-2222-4222-8222-222222222222',10,'manual',clock_timestamp()+interval '5 minutes');
INSERT INTO katosync.mesh_devices
(owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
 VALUES
 ('11111111-1111-4111-8111-111111111111',repeat('A',43),repeat('AA-',15)||'AA','OWNER1_M2','macos'),
 ('11111111-1111-4111-8111-111111111111',repeat('B',43),repeat('BB-',15)||'BB','OWNER1_M3','macos'),
 ('11111111-1111-4111-8111-111111111111',repeat('E',43),repeat('EE-',15)||'EE','OWNER1_THIRD','macos'),
 ('22222222-2222-4222-8222-222222222222',repeat('C',43),repeat('CC-',15)||'CC','OWNER2_M2','macos'),
 ('22222222-2222-4222-8222-222222222222',repeat('D',43),repeat('DD-',15)||'DD','OWNER2_M3','macos');

-- Stage 2L enforces max three recent invitations per owner and lifetime 5 min.
-- First owner: one cancelled, one expired and one genuinely accepted via
-- preexisting target device key-bound single-use recipient proof.
INSERT INTO katosync.mesh_invites
(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
 SELECT a.owner_user_id,a.device_id,b.device_id,repeat(n,43),
        jsonb_build_object('publicKey',
          CASE WHEN n='N' THEN repeat('E',43) ELSE repeat('A',43) END),
        repeat('S',86),clock_timestamp()+seconds*interval '1 second'
 FROM (VALUES ('L',120,'A','B'),('M',1,'A','E'),('N',180,'E','B'))
   v(n,seconds,source_char,target_char)
 JOIN katosync.mesh_devices a
   ON a.signing_public_key=repeat(source_char,43)
 JOIN katosync.mesh_devices b
   ON b.owner_user_id=a.owner_user_id
   AND b.signing_public_key=repeat(target_char,43);

-- Second owner will be used for a genuine two-psql-session accept-vs-cancel race.
INSERT INTO katosync.mesh_invites
(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
 SELECT a.owner_user_id,a.device_id,b.device_id,repeat('R',43),
        jsonb_build_object('publicKey',repeat('C',43)),
        repeat('S',86),clock_timestamp()+interval '3 minutes'
 FROM katosync.mesh_devices a
 JOIN katosync.mesh_devices b ON b.owner_user_id=a.owner_user_id
 WHERE a.signing_public_key=repeat('C',43) AND b.signing_public_key=repeat('D',43);

-- Proof for the existing accepted/rejected path. It MUST remain unchanged
-- by the lifecycle overlay; all recipient/device/key checks still run.
INSERT INTO katosync.mesh_inbox_proofs
(owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at)
 SELECT i.owner_user_id,i.target_device_id,repeat('B',43),
        repeat('P',43),'accept',i.request_id,clock_timestamp()+interval '60 seconds'
 FROM katosync.mesh_invites i
 WHERE i.nonce=repeat('N',43);
UPDATE katosync.mesh_invites i
 SET state='accepted',resolved_at=clock_timestamp(),
     resolution_proof_id=(
       SELECT p.proof_id FROM katosync.mesh_inbox_proofs p
       WHERE p.request_id=i.request_id AND p.action='accept')
 WHERE i.owner_user_id='11111111-1111-4111-8111-111111111111'
   AND i.nonce=repeat('N',43) AND i.state='pending';
DO $$
BEGIN
 IF (SELECT count(*) FROM katosync.mesh_invites
     WHERE nonce=repeat('N',43) AND state='accepted' AND resolution_proof_id IS NOT NULL)<>1
 THEN RAISE EXCEPTION 'INBOX_LIFECYCLE_QA_LEGACY_ACCEPT_BROKEN'; END IF;
END $$;
\echo KATOSYNC_INBOX_LIFECYCLE_LEGACY_SIGNED_DECISION_UNCHANGED_PASS

-- The wrong owner's service-role RPC call must not discover/close this row.
DO $$
DECLARE owner uuid:='11111111-1111-4111-8111-111111111111';
DECLARE wrong uuid:='22222222-2222-4222-8222-222222222222';
DECLARE id uuid; result text; msg text;
BEGIN
 SELECT request_id INTO id FROM katosync.mesh_invites WHERE nonce=repeat('L',43);
 result:=katosync.mesh_inbox_terminal_close_qa(wrong,id,'cancelled');
 IF result<>'not_found' THEN RAISE EXCEPTION 'INBOX_LIFECYCLE_CROSS_OWNER_LEAK'; END IF;
 BEGIN
  PERFORM katosync.mesh_inbox_terminal_close_qa(owner,id,'accepted');
  RAISE EXCEPTION 'INBOX_LIFECYCLE_UNKNOWN_STATE_ACCEPTED';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 SELECT request_id INTO id FROM katosync.mesh_invites WHERE nonce=repeat('N',43);
 result:=katosync.mesh_inbox_terminal_close_qa(owner,id,'cancelled');
 IF result<>'not_pending' THEN RAISE EXCEPTION 'INBOX_LIFECYCLE_ACCEPTED_CHANGED'; END IF;
 SELECT request_id INTO id FROM katosync.mesh_invites WHERE nonce=repeat('L',43);
 result:=katosync.mesh_inbox_terminal_close_qa(owner,id,'expired');
 IF result<>'wrong_deadline' THEN RAISE EXCEPTION 'INBOX_LIFECYCLE_PREMATURE_EXPIRY'; END IF;

 -- Even privileged service code cannot mutate original signed payload,
 -- recipient, request identifier, owner, or attached proof on terminal close.
 BEGIN
  UPDATE katosync.mesh_invites
    SET state='cancelled',resolved_at=clock_timestamp(),signed_offer='{"tampered":true}'
  WHERE owner_user_id=owner AND request_id=id;
  RAISE EXCEPTION 'INBOX_LIFECYCLE_SIGNED_PAYLOAD_MUTATED';
 EXCEPTION WHEN SQLSTATE '23514' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'KATOSYNC_MESH_ATOMIC_TERMINAL_DENIED'
  THEN RAISE EXCEPTION 'INBOX_LIFECYCLE_WRONG_SIGNED_DENIAL: %',msg;END IF;
 END;
END $$;
\echo KATOSYNC_INBOX_LIFECYCLE_OWNER_SCOPE_PAYLOAD_LOCK_PASS

-- Plan AND membership are revoked before closing. Device revocation must
-- not prevent expiration/cancellation of now unsafe pending invitations.
DELETE FROM katosync.mesh_owner_policy
 WHERE owner_user_id='11111111-1111-4111-8111-111111111111';
UPDATE katosync.account_memberships SET access_state='revoked',
 revoked_at=clock_timestamp()
 WHERE user_id='11111111-1111-4111-8111-111111111111';
UPDATE katosync.mesh_devices SET membership_state='revoked',
 revoked_at=clock_timestamp()
 WHERE owner_user_id='11111111-1111-4111-8111-111111111111'
   AND signing_public_key=repeat('B',43);

-- A deadline may be short. Past-due invitation becomes permanently expired,
-- even though membership and Pro/Trial policy no longer authorize writes.
SELECT pg_sleep(1.3);
DO $$
DECLARE owner uuid:='11111111-1111-4111-8111-111111111111';
DECLARE id uuid; result text; msg text;
BEGIN
 SELECT request_id INTO id FROM katosync.mesh_invites
 WHERE owner_user_id=owner AND nonce=repeat('L',43);
 result:=katosync.mesh_inbox_terminal_close_qa(owner,id,'cancelled');
 IF result<>'closed' THEN RAISE EXCEPTION 'INBOX_LIFECYCLE_REVOKED_CANCEL_FAILED: %',result; END IF;
 result:=katosync.mesh_inbox_terminal_close_qa(owner,id,'cancelled');
 IF result<>'already_closed' THEN RAISE EXCEPTION 'INBOX_LIFECYCLE_CANCEL_NOT_IDEMPOTENT'; END IF;
 BEGIN
  UPDATE katosync.mesh_invites SET state='accepted',resolved_at=clock_timestamp()
   WHERE request_id=id;
  RAISE EXCEPTION 'INBOX_LIFECYCLE_CANCEL_REOPENED';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
 SELECT request_id INTO id FROM katosync.mesh_invites
 WHERE owner_user_id=owner AND nonce=repeat('M',43);
 result:=katosync.mesh_inbox_terminal_close_qa(owner,id,'expired');
 IF result<>'closed' THEN RAISE EXCEPTION 'INBOX_LIFECYCLE_EXPIRED_NOT_CLOSED: %',result; END IF;
 result:=katosync.mesh_inbox_terminal_close_qa(owner,id,'expired');
 IF result<>'already_closed' THEN RAISE EXCEPTION 'INBOX_LIFECYCLE_EXPIRE_NOT_IDEMPOTENT'; END IF;
 IF (SELECT count(*) FROM katosync.mesh_inbox_lifecycle_audit_qa
     WHERE owner_user_id=owner)<>2 THEN
   RAISE EXCEPTION 'INBOX_LIFECYCLE_NONATOMIC_OR_DUPLICATE_AUDIT';
 END IF;
 IF (SELECT count(*) FROM katosync.mesh_invites
     WHERE owner_user_id=owner AND state IN ('cancelled','expired')
       AND resolution_proof_id IS NULL AND resolved_at IS NOT NULL)<>2 THEN
   RAISE EXCEPTION 'INBOX_LIFECYCLE_TERMINAL_CONSISTENCY';
 END IF;
 IF (SELECT count(*) FROM katosync.mesh_invites
     WHERE owner_user_id=owner AND state='accepted'
       AND resolution_proof_id IS NOT NULL)<>1 THEN
   RAISE EXCEPTION 'INBOX_LIFECYCLE_PREEXISTING_DECISION_REWRITTEN';
 END IF;
END $$;
\echo KATOSYNC_INBOX_LIFECYCLE_CANCEL_EXPIRE_AFTER_REVOCATION_PASS

-- Verify privileges: public clients cannot call lifecycle closure, alter
-- audit rows or bypass the original device proof path.
RESET ROLE;
DO $$
BEGIN
 IF has_function_privilege('anon','katosync.mesh_inbox_terminal_close_qa(uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','katosync.mesh_inbox_terminal_close_qa(uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('anon','katosync.mesh_inbox_terminal_valid_qa(katosync.mesh_invites,katosync.mesh_invites)','EXECUTE')
 OR has_function_privilege('authenticated','katosync.mesh_inbox_terminal_valid_qa(katosync.mesh_invites,katosync.mesh_invites)','EXECUTE')
 OR has_table_privilege('anon','katosync.mesh_inbox_lifecycle_audit_qa','INSERT,UPDATE,SELECT')
 OR has_table_privilege('authenticated','katosync.mesh_inbox_lifecycle_audit_qa','INSERT,UPDATE,SELECT')
 OR has_table_privilege('authenticated','katosync.mesh_invites','UPDATE')
 THEN RAISE EXCEPTION 'INBOX_LIFECYCLE_PUBLIC_AUTHORIZATION_OPEN'; END IF;
 IF (SELECT count(*) FROM pg_trigger
 WHERE tgrelid='katosync.mesh_invites'::regclass
   AND NOT tgisinternal AND tgenabled='O')<4
 THEN RAISE EXCEPTION 'INBOX_LIFECYCLE_REQUIRED_TRIGGERS_MISSING'; END IF;
END $$;
\echo KATOSYNC_INBOX_LIFECYCLE_CLIENT_GRANTS_AND_AUDIT_PASS

-- Owner 2 remains active for the real concurrent accept-vs-cancel test.
SET ROLE service_role;
INSERT INTO katosync.mesh_inbox_proofs
(owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at)
 SELECT i.owner_user_id,i.target_device_id,repeat('D',43),
        repeat('V',43),'accept',i.request_id,clock_timestamp()+interval '60 seconds'
 FROM katosync.mesh_invites i WHERE i.nonce=repeat('R',43);
RESET ROLE;
\echo KATOSYNC_INBOX_LIFECYCLE_CONCURRENT_FIXTURE_READY
