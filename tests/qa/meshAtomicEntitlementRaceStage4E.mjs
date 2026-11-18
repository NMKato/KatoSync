// NMKato Solutions — REAL concurrent PostgreSQL 17 transaction QA, socket ONLY.
// Invoked exclusively by scripts/qa-mesh-postgres-local.sh on a disposable PG.
// Never accepts remote DSNs, user data, KATOOS service keys or network sockets.
import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import {realpathSync,statSync} from "node:fs";
const OWNER="11111111-1111-4111-8111-111111111111";
const socket=process.env.KATOSYNC_MESH_E2E_SOCKET??"";
const port=process.env.KATOSYNC_MESH_E2E_PORT??"";
const pgBin=process.env.KATOSYNC_PG_BIN??"/opt/homebrew/opt/postgresql@17/bin";
if(process.env.KATOSYNC_MESH_ATOMIC_RACE_ALLOW!=="EPHEMERAL_UNIX_SOCKET_ONLY"||
 !/^\/tmp\/ksmeshqa\.[A-Za-z0-9]{6}$/.test(socket)||
 !socket.startsWith("/tmp/ksmeshqa.")||port!=="55439")
 throw Error("KATOSYNC_ATOMIC_RACE_NO_DISPOSABLE_SOCKET");
const real=realpathSync(socket);
// macOS may resolve /tmp to /private/tmp. Both must name the same strict
// ephemeral socket directory; do not permit any other redirected location.
assert.ok(real===socket||real==="/private"+socket,
 "socket resolves outside disposable /tmp PG QA");
assert.equal(statSync(real).mode&0o777,0o700);
const binary=pgBin+"/psql";
const args=["-h",socket,"-p",port,"-U","postgres","-d","postgres","-X","-At",
 "-v","ON_ERROR_STOP=1"];
function sql(query){
 return execFileSync(binary,[...args,"-c",query],
 {encoding:"utf8",timeout:6000,maxBuffer:32_768}).trim();
}
function proc(query){
 const child=spawn(binary,[...args,"-c",query],{
  env:{...process.env,PGOPTIONS:"-c statement_timeout=6000 -c lock_timeout=5000"},
  stdio:["ignore","pipe","pipe"]});
 let output="",error="",done=false;
 child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
 child.stdout.on("data",s=>{output+=s;});
 child.stderr.on("data",s=>{error+=s;});
 const result=new Promise((resolve,reject)=>{
  child.once("error",reject);
  child.once("exit",code=>{done=true;resolve({code,output,error});});
 });
 return {child,result,get done(){return done;}};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ownerA=OWNER;
const readTable="katosync.mesh_pairing_relay_reads";
const deviceSql=`(SELECT device_id FROM katosync.mesh_devices WHERE owner_user_id='${ownerA}' AND signing_public_key=repeat('A',43))`;
function insert(nonce){
 return `INSERT INTO ${readTable}(owner_user_id,device_id,nonce,expires_at)
 VALUES('${ownerA}',${deviceSql},repeat('${nonce}',43),
 clock_timestamp()+interval '60 seconds');`;
}
sql(`UPDATE katosync.mesh_owner_policy
 SET policy_expires_at=clock_timestamp()+interval '5 minutes'
 WHERE owner_user_id='${OWNER}'`);
const before=Number(sql(`SELECT count(*) FROM ${readTable} WHERE owner_user_id='${OWNER}'`));
assert.ok(Number.isInteger(before)&&before>=1);
const writer=proc(`BEGIN;SET LOCAL ROLE service_role;${insert("V")}
 SELECT pg_sleep(1.6);COMMIT;`);
let writerLockSeen=false;
for(let i=0;i<24;i++){
 if(writer.done)break;
 const free=sql(`SELECT pg_try_advisory_lock(pg_catalog.hashtext('${OWNER}')::bigint)`);
 if(free==="f"){writerLockSeen=true;break;}
 assert.equal(free,"t");
 await sleep(45);
}
assert.ok(writerLockSeen,"writer did not acquire owner xact lock");
const revoker=proc(`UPDATE katosync.mesh_owner_policy
 SET policy_expires_at=clock_timestamp()-interval '1 second'
 WHERE owner_user_id='${OWNER}'`);
await sleep(180);
assert.equal(revoker.done,false,
 "revocation UPDATE raced through before the authorized insert committed");
const wrote=await writer.result;
assert.equal(wrote.code,0,"allowed write failed: "+wrote.error.slice(0,280));
const revoked=await revoker.result;
assert.equal(revoked.code,0,"revoke failed: "+revoked.error.slice(0,280));
assert.equal(Number(sql(`SELECT count(*) FROM ${readTable}
 WHERE owner_user_id='${OWNER}'`)),before+1);
const blocked=proc(`SET ROLE service_role;${insert("W")}`);
const denied=await blocked.result;
assert.notEqual(denied.code,0,"new Mesh write after committed revoke allowed");
assert.match(denied.error,/KATOSYNC_MESH_ENTITLEMENT_REQUIRED/);
assert.equal(Number(sql(`SELECT count(*) FROM ${readTable}
 WHERE owner_user_id='${OWNER}'`)),before+1);
console.log("KATOSYNC_STAGE4E_ATOMIC_REVOKE_RACE_SERIALIZED_PASS");
console.log("KATOSYNC_STAGE4E_ATOMIC_POST_REVOKE_WRITE_DENIED_PASS");
