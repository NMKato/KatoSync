-- NMKato Solutions — disposable PostgreSQL security proof fixture ONLY.
-- Executes previous stack's real assertions, then new additive hardening.
\set ON_ERROR_STOP on
\ir mesh_inbox_receive_qa.sql
\ir ../../supabase/migrations/20261030074910_mesh_resolution_proof_binding.sql

-- Existing 'accepted' rows predating this additive migration remain readable
-- because the new consistency constraint is NOT VALID. All new writes must
-- have a matching proof and its target-device-scoped owner/action/request.
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_constraint WHERE conname='mesh_invite_proof_resolution_consistency'
     AND NOT convalidated
 ) THEN RAISE EXCEPTION 'MESH_PROOF_LEGACY_MIGRATION_INVALID'; END IF;
 IF has_table_privilege('authenticated','katosync.mesh_invites','UPDATE')
    OR has_table_privilege('anon','katosync.mesh_inbox_proofs','INSERT')
 THEN RAISE EXCEPTION 'MESH_PROOF_CLIENT_WRITE_OPEN'; END IF;
END $$;

-- Retire prior test proofs, restore source device to test key rotation.
DELETE FROM katosync.mesh_invites WHERE state='pending';
DELETE FROM katosync.mesh_inbox_proofs;
UPDATE katosync.mesh_devices
 SET membership_state='discovered',revoked_at=NULL
 WHERE signing_public_key=repeat('A',43);

INSERT INTO katosync.mesh_invites
 (owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
 SELECT owner_user_id,
 (SELECT device_id FROM katosync.mesh_devices WHERE signing_public_key=repeat('A',43)),
 (SELECT device_id FROM katosync.mesh_devices WHERE signing_public_key=repeat('B',43)),
 repeat('G',43),jsonb_build_object('publicKey',repeat('A',43)),
 repeat('X',86),now()+interval '3 minutes'
 FROM katosync.mesh_devices WHERE signing_public_key=repeat('A',43);

DO $$
DECLARE owner uuid='11111111-1111-4111-8111-111111111111';
DECLARE request uuid;
DECLARE recipient uuid;
DECLARE good uuid;
DECLARE wrong uuid;
BEGIN
 SELECT request_id INTO request FROM katosync.mesh_invites WHERE nonce=repeat('G',43);
 SELECT device_id INTO recipient FROM katosync.mesh_devices WHERE signing_public_key=repeat('B',43);

 -- Even service_role cannot accept without a target-attested matching proof.
 BEGIN
  UPDATE katosync.mesh_invites SET state='accepted',resolved_at=now()
    WHERE request_id=request;
  RAISE EXCEPTION 'MESH_PROOF_MISSING_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 INSERT INTO katosync.mesh_inbox_proofs
  (owner_user_id,device_id,nonce,action,request_id,expires_at)
 VALUES(owner,recipient,repeat('H',43),'reject',request,now()+interval '60 seconds')
 RETURNING proof_id INTO wrong;
 BEGIN
  UPDATE katosync.mesh_invites SET state='accepted',resolved_at=now(),resolution_proof_id=wrong
    WHERE request_id=request;
  RAISE EXCEPTION 'MESH_PROOF_WRONG_ACTION_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 INSERT INTO katosync.mesh_inbox_proofs
  (owner_user_id,device_id,nonce,action,request_id,expires_at)
 VALUES(owner,recipient,repeat('I',43),'accept',gen_random_uuid(),now()+interval '60 seconds')
 RETURNING proof_id INTO wrong;
 BEGIN
  UPDATE katosync.mesh_invites SET state='accepted',resolved_at=now(),resolution_proof_id=wrong
    WHERE request_id=request;
  RAISE EXCEPTION 'MESH_PROOF_WRONG_REQUEST_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 INSERT INTO katosync.mesh_inbox_proofs
  (owner_user_id,device_id,nonce,action,request_id,expires_at)
 VALUES(owner,recipient,repeat('J',43),'accept',request,now()+interval '60 seconds')
 RETURNING proof_id INTO good;

 -- The target device cannot authorize an invite whose source key was changed.
 UPDATE katosync.mesh_devices SET signing_public_key=repeat('Z',43)
   WHERE signing_public_key=repeat('A',43);
 BEGIN
  UPDATE katosync.mesh_invites SET state='accepted',resolved_at=now(),resolution_proof_id=good
    WHERE request_id=request;
  RAISE EXCEPTION 'MESH_PROOF_SOURCE_ROTATION_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 UPDATE katosync.mesh_devices SET signing_public_key=repeat('A',43)
   WHERE signing_public_key=repeat('Z',43);

 -- Correct owner+recipient+request+action+source key permits exactly one decision.
 UPDATE katosync.mesh_invites SET state='accepted',resolved_at=now(),resolution_proof_id=good
   WHERE request_id=request AND state='pending' AND expires_at>now();
 IF (SELECT state FROM katosync.mesh_invites WHERE request_id=request) <> 'accepted'
   OR (SELECT resolution_proof_id FROM katosync.mesh_invites WHERE request_id=request) <> good
 THEN RAISE EXCEPTION 'MESH_PROOF_VALID_ACCEPT_FAILED'; END IF;
 BEGIN
  UPDATE katosync.mesh_invites SET state='rejected',resolved_at=now(),resolution_proof_id=wrong
    WHERE request_id=request;
  RAISE EXCEPTION 'MESH_PROOF_SECOND_DECISION_OPEN';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
\echo MESH_INBOX_RESOLUTION_PROOF_BINDING_PASS
