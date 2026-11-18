// NMKato Solutions — two real concurrent PostgreSQL 17 sessions, no remote
// connections. Exercise same invitation: cancel vs recipient's signed proof.
import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import {realpathSync,statSync} from "node:fs";
const owner="22222222-2222-4222-8222-222222222222";
const sock=process.env.KATOSYNC_MESH_E2E_SOCKET??"";
const port=process.env.KATOSYNC_MESH_E2E_PORT??"";
const pgBin=process.env.KATOSYNC_PG_BIN??"/opt/homebrew/opt/postgresql@17/bin";
if(process.env.KATOSYNC_INBOX_LIFECYCLE_RACE_ALLOW!=="LOCAL_DISPOSABLE_PG17"||
 !/^\/tmp\/ksmeshqa\.[A-Za-z0-9]{6}$/.test(sock)||port!=="55439")
 throw Error("KATOSYNC_INBOX_RACE_NOT_EPHEMERAL");
const resolved=realpathSync(sock);
assert.ok(resolved===sock||resolved==="/private"+sock);
assert.equal(statSync(resolved).mode&0o777,0o700);
const binary=pgBin+"/psql";
const args=["-h",sock,"-p",port,"-U","postgres","-d","postgres",
  "-X","-At","-v","ON_ERROR_STOP=1"];
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
function query(sql){
 return execFileSync(binary,[...args,"-c",sql],{
  encoding:"utf8",timeout:6500,maxBuffer:40000}).trim();
}
function launch(sql){
 const child=spawn(binary,[...args,"-c",sql],{
  env:{...process.env,PGOPTIONS:"-c statement_timeout=6500 -c lock_timeout=5000"},
  stdio:["ignore","pipe","pipe"]});
 let stdout="",stderr="",finished=false;
 child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
 child.stdout.on("data",t=>stdout+=t);
 child.stderr.on("data",t=>stderr+=t);
 const promise=new Promise((resolve,reject)=>{
  child.once("error",reject);
  child.once("exit",code=>{finished=true;resolve({code,stdout,stderr});});
 });
 return {promise,get finished(){return finished;}};
}
const invite=query(`SELECT request_id FROM katosync.mesh_invites
 WHERE owner_user_id='${owner}' AND nonce=repeat('R',43) AND state='pending'`);
assert.match(invite,/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
const proof=query(`SELECT proof_id FROM katosync.mesh_inbox_proofs
 WHERE owner_user_id='${owner}' AND request_id='${invite}' AND action='accept'`);
assert.match(proof,/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
const countBefore=Number(query(`SELECT count(*) FROM katosync.mesh_inbox_lifecycle_audit_qa`));
assert.equal(countBefore,2);
const first=launch(`BEGIN;
 SET LOCAL ROLE service_role;
 SELECT request_id FROM katosync.mesh_invites
 WHERE owner_user_id='${owner}' AND request_id='${invite}' FOR UPDATE;
 SELECT pg_sleep(1.6);
 SELECT katosync.mesh_inbox_terminal_close_qa(
   '${owner}'::uuid,'${invite}'::uuid,'cancelled');
 COMMIT;`);
await sleep(250);
assert.equal(first.finished,false,"cancel transaction ended before race");
const second=launch(`SET ROLE service_role;
 UPDATE katosync.mesh_invites
 SET state='accepted',resolved_at=clock_timestamp(),
     resolution_proof_id='${proof}'::uuid
 WHERE owner_user_id='${owner}' AND request_id='${invite}'
   AND state='pending' AND expires_at>clock_timestamp()
 RETURNING request_id;`);
await sleep(220);
assert.equal(second.finished,false,
 "decision did not wait on concurrent pending-row lock");
const closed=await first.promise;
assert.equal(closed.code,0,"cancel failed: "+closed.stderr.slice(0,600));
assert.match(closed.stdout,/closed/);
const accepted=await second.promise;
assert.equal(accepted.code,0,"decision SQL failed: "+accepted.stderr.slice(0,600));
assert.doesNotMatch(accepted.stdout,new RegExp(invite,"i"),
 "late recipient decision produced an accepted row after cancellation");
assert.equal(query(`SELECT state FROM katosync.mesh_invites
 WHERE owner_user_id='${owner}' AND request_id='${invite}'`),"cancelled");
assert.equal(Number(query(`SELECT count(*) FROM katosync.mesh_inbox_lifecycle_audit_qa
 WHERE request_id='${invite}' AND owner_user_id='${owner}'
 AND terminal_state='cancelled'`)),1);
assert.equal(Number(query(`SELECT count(*) FROM katosync.mesh_inbox_lifecycle_audit_qa`)),
 countBefore+1);
const replay=query(`SET ROLE service_role;
 SELECT katosync.mesh_inbox_terminal_close_qa(
 '${owner}'::uuid,'${invite}'::uuid,'cancelled');`);
assert.match(replay,/already_closed/);
assert.equal(Number(query(`SELECT count(*) FROM katosync.mesh_inbox_lifecycle_audit_qa`)),
 countBefore+1);
console.log("KATOSYNC_INBOX_LIFECYCLE_CANCEL_VS_ACCEPT_SERIALIZED_PASS");
console.log("KATOSYNC_INBOX_LIFECYCLE_LATE_RECIPIENT_DECISION_DENIED_PASS");
console.log("KATOSYNC_INBOX_LIFECYCLE_IDEMPOTENT_AUDIT_NO_DUPLICATE_PASS");
