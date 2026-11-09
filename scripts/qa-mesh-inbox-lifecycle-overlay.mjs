// NMKato Solutions — QA-only patch of pinned Postgres functions in an
// isolated PostgreSQL 17 Unix-socket cluster. Never deploy, mutate historical
// fixtures, rewrite hashes, load credentials or connect to Supabase.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,realpathSync,statSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const destination=process.argv[2];
const required=process.env.KATOSYNC_INBOX_LIFECYCLE_QA_ONLY;
if(required!=="LOCAL_DISPOSABLE_PG17"||typeof destination!=="string"||
 !/^\/tmp\/ksmeshqa\.[A-Za-z0-9]{6}\/inbox_lifecycle_overlay\.sql$/.test(destination))
 throw Error("KATOSYNC_INBOX_LIFECYCLE_DISPOSABLE_REQUIRED");
const folder=realpathSync(dirname(destination));
if(folder!==dirname(destination)&&folder!=="/private"+dirname(destination))
 throw Error("KATOSYNC_INBOX_LIFECYCLE_UNEXPECTED_DIRECTORY");
assert.equal(statSync(folder).mode&0o777,0o700);
const sources=[
 ["tests/fixtures/migrations/20261030072543_mesh_recipient_signed_inbox_atomic_decisions.sql",
  "ca57d61435f7f3620ec2f311d93a188210ef12d25ac7a520f74b781ac634197e",
  "mesh_inbox_resolution_guard","$$;"],
 ["tests/fixtures/migrations/20261030074910_mesh_resolution_proof_binding.sql",
  "cd1b2e9c1e52b28e7012f4cccaf5ce193c5f6e317ee190e28e272d4d5bab8281",
  "mesh_inbox_resolution_proof_guard","$$;"],
 ["tests/sql/mesh_stage4e_atomic_write_overlay_qa.sql",
  "a1afad3bb0327456155774b2393d921366733c4abb915e7f5e88457052ef085b",
  "mesh_atomic_write_entitlement_qa","$gate$;"]
];
const base={
  preflight:`
-- QA-generated only. Requires explicit local disposable DB gate.
DO $pre$
BEGIN
 IF pg_catalog.current_setting('katosync.qa_disposable',true)
    IS DISTINCT FROM 'unix-socket-qa-only'
    OR pg_catalog.inet_server_addr() IS NOT NULL
    OR current_user<>'postgres'
 THEN RAISE EXCEPTION 'KATOSYNC_INBOX_LIFECYCLE_QA_ONLY_REFUSED'
   USING ERRCODE='42501';
 END IF;
 IF to_regclass('katosync.mesh_inbox_proofs') IS NULL
    OR to_regprocedure('katosync.mesh_atomic_write_entitlement_qa()') IS NULL
 THEN RAISE EXCEPTION 'KATOSYNC_INBOX_LIFECYCLE_MISSING_GATES';
 END IF;
END $pre$;
`,
  helper:`
CREATE FUNCTION katosync.mesh_inbox_terminal_valid_qa(
  p_old katosync.mesh_invites,p_new katosync.mesh_invites
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $terminal$
DECLARE t timestamptz:=pg_catalog.clock_timestamp();
BEGIN
  IF current_user<>'service_role'
     OR p_old.state IS DISTINCT FROM 'pending'
     OR p_old.resolution_proof_id IS NOT NULL
     OR p_new.resolution_proof_id IS NOT NULL
     OR p_new.state NOT IN ('cancelled','expired')
     OR p_new.resolved_at IS NULL
     OR p_new.resolved_at < p_old.created_at
     OR p_new.resolved_at < t-interval '5 seconds'
     OR p_new.resolved_at > t+interval '2 seconds'
     OR (pg_catalog.to_jsonb(p_old)-'state'-'resolved_at')
         IS DISTINCT FROM (pg_catalog.to_jsonb(p_new)-'state'-'resolved_at')
  THEN RETURN false; END IF;
  IF p_new.state='cancelled' AND p_old.expires_at <= t THEN RETURN false; END IF;
  IF p_new.state='expired' AND p_old.expires_at > t THEN RETURN false; END IF;
  RETURN true;
END;
$terminal$;
REVOKE ALL ON FUNCTION katosync.mesh_inbox_terminal_valid_qa(
  katosync.mesh_invites,katosync.mesh_invites) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_inbox_terminal_valid_qa(
  katosync.mesh_invites,katosync.mesh_invites) TO service_role;
`,
  auditAndRpc:`
-- Minimal nonsecret audit. Required AFTER update: failed audit INSERT
-- aborts the state change in the SAME transaction, not after the fact.
CREATE TABLE katosync.mesh_inbox_lifecycle_audit_qa(
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request_id uuid NOT NULL UNIQUE,
 owner_user_id uuid NOT NULL,
 previous_state text NOT NULL CHECK(previous_state='pending'),
 terminal_state text NOT NULL CHECK(terminal_state IN ('cancelled','expired')),
 db_role text NOT NULL CHECK(db_role='service_role'),
 recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE katosync.mesh_inbox_lifecycle_audit_qa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.mesh_inbox_lifecycle_audit_qa FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON katosync.mesh_inbox_lifecycle_audit_qa TO service_role;
GRANT USAGE,SELECT ON SEQUENCE katosync.mesh_inbox_lifecycle_audit_qa_audit_id_seq TO service_role;

CREATE FUNCTION katosync.mesh_inbox_terminal_audit_qa()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $audit$
BEGIN
 IF NEW.state IN ('cancelled','expired') THEN
  IF NOT katosync.mesh_inbox_terminal_valid_qa(OLD,NEW)
  THEN RAISE EXCEPTION 'KATOSYNC_INBOX_LIFECYCLE_AUDIT_REJECTED'
   USING ERRCODE='23514'; END IF;
  INSERT INTO katosync.mesh_inbox_lifecycle_audit_qa(
   request_id,owner_user_id,previous_state,terminal_state,db_role
  ) VALUES (NEW.request_id,NEW.owner_user_id,OLD.state,NEW.state,
            current_user);
 END IF;
 RETURN NEW;
END $audit$;
REVOKE ALL ON FUNCTION katosync.mesh_inbox_terminal_audit_qa()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_inbox_terminal_audit_qa()
 TO service_role;
CREATE TRIGGER z_katosync_inbox_terminal_audit_qa
 AFTER UPDATE OF state ON katosync.mesh_invites
 FOR EACH ROW EXECUTE FUNCTION katosync.mesh_inbox_terminal_audit_qa();

-- Deliberately owner-scoped invoker function. The CALLING Edge route must
-- authenticate the actual owner upstream; a service-role alone is NOT an
-- independent user-identity attestation.
CREATE FUNCTION katosync.mesh_inbox_terminal_close_qa(
 p_owner uuid,p_request uuid,p_terminal text
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $close$
DECLARE row_state text;
DECLARE row_expires timestamptz;
DECLARE affected integer;
BEGIN
 IF current_user<>'service_role' OR p_owner IS NULL
    OR p_request IS NULL OR p_terminal NOT IN ('cancelled','expired')
 THEN RAISE EXCEPTION 'KATOSYNC_INBOX_TERMINAL_CALL_NOT_AUTHORIZED'
  USING ERRCODE='42501'; END IF;
 SELECT i.state,i.expires_at INTO row_state,row_expires
 FROM katosync.mesh_invites i
 WHERE i.owner_user_id=p_owner AND i.request_id=p_request FOR UPDATE;
 IF NOT FOUND THEN RETURN 'not_found'; END IF;
 IF row_state=p_terminal THEN RETURN 'already_closed'; END IF;
 IF row_state<>'pending' THEN RETURN 'not_pending'; END IF;
 IF (p_terminal='cancelled' AND row_expires<=pg_catalog.clock_timestamp())
    OR (p_terminal='expired' AND row_expires>pg_catalog.clock_timestamp())
 THEN RETURN 'wrong_deadline'; END IF;
 UPDATE katosync.mesh_invites SET
  state=p_terminal,resolved_at=pg_catalog.clock_timestamp()
 WHERE owner_user_id=p_owner AND request_id=p_request
   AND state='pending';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'KATOSYNC_INBOX_TERMINAL_UPDATE_RACE'
   USING ERRCODE='23514'; END IF;
 RETURN 'closed';
END $close$;
REVOKE ALL ON FUNCTION katosync.mesh_inbox_terminal_close_qa(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION katosync.mesh_inbox_terminal_close_qa(uuid,uuid,text)
 TO service_role;
`
};
const branches={
 mesh_inbox_resolution_guard:`
  IF NEW.state IN ('cancelled','expired') THEN
    IF NOT katosync.mesh_inbox_terminal_valid_qa(OLD,NEW) THEN
      RAISE EXCEPTION 'KATOSYNC_MESH_INBOX_INVALID_TERMINAL'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
`,
 mesh_inbox_resolution_proof_guard:`
  IF NEW.state IN ('cancelled','expired') THEN
    IF NOT katosync.mesh_inbox_terminal_valid_qa(OLD,NEW) THEN
      RAISE EXCEPTION 'KATOSYNC_MESH_INBOX_TERMINAL_PROOF_MISMATCH'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
`,
 mesh_atomic_write_entitlement_qa:`
  -- Terminal cleanup cannot grant pairing or remote-job rights.
  -- Allow cleanup even when an owner's Pro plan/membership was revoked.
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='mesh_invites' THEN
    IF NEW.state IN ('cancelled','expired') THEN
      IF NOT katosync.mesh_inbox_terminal_valid_qa(OLD,NEW) THEN
        RAISE EXCEPTION 'KATOSYNC_MESH_ATOMIC_TERMINAL_DENIED'
         USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
  END IF;
`
};
const pieces=[base.preflight,base.helper];
for(const [relative,expected,name,term] of sources){
 const file=join(root,relative);
 const raw=readFileSync(file,"utf8");
 // Git-for-Windows may check out a source as CRLF. Validate the immutable
 // canonical Git-blob SHA, not the platform-specific working-tree EOL bytes.
 // Never permit a stray CR or normalize any other source character.
 assert.equal(/\r(?!\n)/.test(raw),false,"noncanonical lone CR in "+relative);
 const original=raw.replace(/\r\n/g,"\n");
 assert.equal(createHash("sha256").update(original).digest("hex"),expected,
   "historical source changed; must obtain independent review: "+relative);
 const start="CREATE FUNCTION katosync."+name+"()";
 assert.equal(original.split(start).length-1,1,"missing/duplicate original func "+name);
 const beginning=original.indexOf(start);
 const ending=original.indexOf("\n"+term,beginning);
 assert.ok(ending>beginning,"unclosed source function");
 let block=original.slice(beginning,ending+1+term.length);
 assert.equal(block.split("\nBEGIN\n").length-1,1,"unexpected control flow "+name);
 block=block.replace("CREATE FUNCTION","CREATE OR REPLACE FUNCTION");
 block=block.replace("\nBEGIN\n","\nBEGIN\n"+branches[name]);
 pieces.push("-- QA synthesized from VERIFIED original "+name+"\n"+block+"\n");
}
pieces.push(base.auditAndRpc);
writeFileSync(destination,pieces.join("\n"),{flag:"wx",mode:0o600});
console.log("KATOSYNC_INBOX_LIFECYCLE_SHA_PINNED_OVERRIDE_PREPARED");
