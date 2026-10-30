-- NMKato Solutions — disposable PostgreSQL 17 only, never on live DB.
\set ON_ERROR_STOP on
\ir mesh_resolution_proof_qa.sql
\ir ../../supabase/migrations/20261030093323_mesh_inbox_recipient_key_continuity.sql

DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_constraint
   WHERE conname='mesh_inbox_proof_signing_key_required' AND NOT convalidated
 ) THEN RAISE EXCEPTION 'MESH_RECIPIENT_KEY_LEGACY_SAFE_CHECK_MISSING'; END IF;
 IF has_table_privilege('authenticated','katosync.mesh_inbox_proofs','INSERT')
    OR has_table_privilege('authenticated','katosync.mesh_inbox_proofs','UPDATE')
 THEN RAISE EXCEPTION 'MESH_RECIPIENT_KEY_CLIENT_WRITE_OPEN'; END IF;
END $$;

-- Retire local-only fixture rows after proving the preceding migration.
DELETE FROM katosync.mesh_invites;
DELETE FROM katosync.mesh_inbox_proofs;

INSERT INTO katosync.mesh_invites
 (owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
SELECT owner_user_id,
 (SELECT device_id FROM katosync.mesh_devices WHERE signing_public_key=repeat('A',43)),
 (SELECT device_id FROM katosync.mesh_devices WHERE signing_public_key=repeat('B',43)),
 repeat('S',43),jsonb_build_object('publicKey',repeat('A',43)),
 repeat('X',86),now()+interval '3 minutes'
FROM katosync.mesh_devices WHERE signing_public_key=repeat('A',43);

DO $$
DECLARE owner uuid='11111111-1111-4111-8111-111111111111';
DECLARE recipient uuid;
DECLARE request uuid;
DECLARE correct uuid;
DECLARE second_request uuid;
DECLARE rejection uuid;
BEGIN
 SELECT device_id INTO recipient FROM katosync.mesh_devices
   WHERE owner_user_id=owner AND signing_public_key=repeat('B',43);
 SELECT request_id INTO request FROM katosync.mesh_invites WHERE nonce=repeat('S',43);

 -- No server path may insert a new unbound recipient proof.
 BEGIN
  INSERT INTO katosync.mesh_inbox_proofs
    (owner_user_id,device_id,nonce,action,request_id,expires_at)
  VALUES(owner,recipient,repeat('U',43),'accept',request,now()+interval '60 seconds');
  RAISE EXCEPTION 'MESH_RECIPIENT_KEY_NULL_PROOF_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 BEGIN
  INSERT INTO katosync.mesh_inbox_proofs
    (owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at)
  VALUES(owner,recipient,repeat('C',43),repeat('V',43),'accept',request,now()+interval '60 seconds');
  RAISE EXCEPTION 'MESH_RECIPIENT_WRONG_KEY_PROOF_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 INSERT INTO katosync.mesh_inbox_proofs
   (owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at)
 VALUES(owner,recipient,repeat('B',43),repeat('W',43),'accept',request,now()+interval '60 seconds')
 RETURNING proof_id INTO correct;

 -- Proof was valid when created, but the recipient has since rotated its key.
 UPDATE katosync.mesh_devices SET signing_public_key=repeat('Y',43)
   WHERE device_id=recipient AND owner_user_id=owner;
 BEGIN
  UPDATE katosync.mesh_invites
     SET state='accepted',resolved_at=now(),resolution_proof_id=correct
   WHERE request_id=request;
  RAISE EXCEPTION 'MESH_RECIPIENT_OLD_KEY_DECISION_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF (SELECT state FROM katosync.mesh_invites WHERE request_id=request)<>'pending'
 THEN RAISE EXCEPTION 'MESH_RECIPIENT_ROTATION_ROLLED_FORWARD'; END IF;

 -- Undo only the synthetic fixture rotation. Then prove correct key allows
 -- a single decision with the other 2O / 2O.1 guards still active.
 UPDATE katosync.mesh_devices SET signing_public_key=repeat('B',43)
   WHERE device_id=recipient AND owner_user_id=owner;
 UPDATE katosync.mesh_invites
   SET state='accepted',resolved_at=now(),resolution_proof_id=correct
 WHERE request_id=request AND state='pending';
 IF NOT EXISTS(SELECT 1 FROM katosync.mesh_invites
   WHERE request_id=request AND state='accepted' AND resolution_proof_id=correct)
 THEN RAISE EXCEPTION 'MESH_RECIPIENT_VALID_PIN_NOT_ACCEPTED'; END IF;

 -- Another invitation must require its OWN proof. Stale cross-request proof
 -- is never usable, even if the target key has not rotated.
 INSERT INTO katosync.mesh_invites
  (owner_user_id,source_device_id,target_device_id,nonce,signed_offer,dispatch_signature,expires_at)
 SELECT owner_user_id,source_device_id,target_device_id,repeat('T',43),
    signed_offer,dispatch_signature,now()+interval '3 minutes'
 FROM katosync.mesh_invites WHERE request_id=request
 RETURNING request_id INTO second_request;

 BEGIN
  UPDATE katosync.mesh_invites
   SET state='rejected',resolved_at=now(),resolution_proof_id=correct
  WHERE request_id=second_request;
  RAISE EXCEPTION 'MESH_RECIPIENT_OTHER_REQUEST_REUSED_PROOF';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 INSERT INTO katosync.mesh_inbox_proofs
  (owner_user_id,device_id,signing_public_key,nonce,action,request_id,expires_at)
 VALUES(owner,recipient,repeat('B',43),repeat('Q',43),'reject',second_request,now()+interval '60 seconds')
 RETURNING proof_id INTO rejection;

 UPDATE katosync.mesh_devices SET membership_state='revoked',revoked_at=now()
   WHERE device_id=recipient;
 BEGIN
  UPDATE katosync.mesh_invites
   SET state='rejected',resolved_at=now(),resolution_proof_id=rejection
  WHERE request_id=second_request;
  RAISE EXCEPTION 'MESH_RECIPIENT_REVOKED_DECISION_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 UPDATE katosync.mesh_devices SET membership_state='discovered',revoked_at=NULL
   WHERE device_id=recipient;
 UPDATE katosync.mesh_invites
   SET state='rejected',resolved_at=now(),resolution_proof_id=rejection
 WHERE request_id=second_request AND state='pending';
 IF NOT EXISTS(SELECT 1 FROM katosync.mesh_invites
   WHERE request_id=second_request AND state='rejected' AND resolution_proof_id=rejection)
 THEN RAISE EXCEPTION 'MESH_RECIPIENT_VALID_REJECT_FAILED'; END IF;
END $$;
\echo MESH_INBOX_RECIPIENT_KEY_CONTINUITY_PASS
