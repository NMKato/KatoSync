// Created by NMKato Solutions
// Echte parallele Sessions, ausschliesslich in der wegwerfbaren Unix-Socket-PG17.
import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import {realpathSync,statSync} from "node:fs";
const socket=process.env.KATOSYNC_MESH_E2E_SOCKET??"";
const port=process.env.KATOSYNC_MESH_E2E_PORT??"";
if(process.env.KATOSYNC_ACCOUNT_NETWORK_RACE_ALLOW!=="EPHEMERAL_UNIX_SOCKET_ONLY"||
 !/^\/tmp\/ksmeshqa\.[A-Za-z0-9]{6}$/.test(socket)||port!=="55439")throw Error("ACCOUNT_NETWORK_TEST_NOT_EPHEMERAL");
const resolved=realpathSync(socket);
assert.ok(resolved===socket||resolved==="/private"+socket);
assert.equal(statSync(resolved).mode&0o777,0o700);
const binary=(process.env.KATOSYNC_PG_BIN??"/opt/homebrew/opt/postgresql@17/bin")+"/psql";
const args=["-h",socket,"-p",port,"-U","postgres","-d","postgres","-X","-At","-v","ON_ERROR_STOP=1"];
const owner="77777777-7777-4777-8777-777777777777",session="55555555-5555-4555-8555-555555555555";
const firstDevice="ffffffff-ffff-4fff-8fff-ffffffffffff",secondDevice="abababab-abab-4bab-8bab-abababababab";
const claims=JSON.stringify({iss:"https://xbnnlyyxiilklsygxcof.supabase.co/auth/v1",aud:"authenticated",role:"authenticated",
 sub:owner,session_id:session,is_anonymous:false,exp:Math.floor(Date.now()/1000)+3600});
const auth=`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${owner}',true);
 SELECT set_config('request.jwt.claims','${claims}',true);`;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function query(sql){return execFileSync(binary,[...args,"-c",sql],{encoding:"utf8",timeout:7000,maxBuffer:40000}).trim();}
let launchIndex=0;
function launch(sql,hold=false){
 const application="mesh_account_network_race_"+(++launchIndex);
 const child=spawn(binary,hold?args:[...args,"-c",sql],{env:{...process.env,PGAPPNAME:application,
  PGOPTIONS:"-c statement_timeout=20000 -c lock_timeout=15000"},stdio:[hold?"pipe":"ignore","pipe","pipe"]});
 let stdout="",stderr="",finished=false;
 child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
 child.stdout.on("data",text=>stdout+=text);child.stderr.on("data",text=>stderr+=text);
 const promise=new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>{finished=true;resolve({code,stdout,stderr});});});
 if(hold)child.stdin.write(sql+"\n");
 return {promise,application,commit(){child.stdin.end("COMMIT;\n\\q\n");},get stdout(){return stdout;},get finished(){return finished;}};
}
async function ready(child,waiting=false){
 for(let count=0;count<30;count++){
  assert.equal(child.finished,false,"transaction stopped before concurrency test");await delay(25);
  const predicate=waiting?"wait_event_type='Lock'":"state='idle in transaction' AND query LIKE '%LOCKED_FOR_RACE%'";
  if(query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${child.application}' AND ${predicate})`)==="t")return;
 }
 throw Error(waiting?"competing transaction did not wait on the real database lock":"held transaction did not reach the checked marker");
}
async function selectionRace(winnerDevice,loserDevice,revision){
 const winner=launch(`BEGIN;${auth}
 SELECT katosync.mesh_account_network_set_primary('${winnerDevice}',${revision});
 SELECT 'LOCKED_FOR_RACE';`,true);
 await ready(winner);
 const loser=launch(`BEGIN;${auth}SELECT katosync.mesh_account_network_set_primary('${loserDevice}',${revision});COMMIT;`);
 await ready(loser,true);winner.commit();
 const [a,b]=await Promise.all([winner.promise,loser.promise]);
 assert.equal(a.code,0,a.stderr);assert.notEqual(b.code,0);assert.match(b.stderr,/MESH_ACCOUNT_REVISION_CONFLICT/);
 assert.equal(query(`SELECT main_device_id||':'||revision FROM katosync.mesh_account_network WHERE owner_user_id='${owner}'`),winnerDevice+":"+(revision+1));
}
assert.equal(query(`SELECT count(*) FROM katosync.mesh_account_network WHERE owner_user_id='${owner}'`),"0");
await selectionRace(firstDevice,secondDevice,0);
console.log("ACCOUNT_NETWORK_INITIAL_CAS_SINGLE_COMMITTED_WINNER_PASS");
await selectionRace(secondDevice,firstDevice,1);
console.log("ACCOUNT_NETWORK_EXISTING_CAS_STALE_WRITER_DENIED_PASS");

const revoker=launch(`BEGIN;UPDATE katosync.mesh_devices SET membership_state='revoked',revoked_at=clock_timestamp()
 WHERE device_id='${firstDevice}';SELECT 'LOCKED_FOR_RACE';`,true);
await ready(revoker);
const selection=launch(`BEGIN;${auth}SELECT katosync.mesh_account_network_set_primary('${firstDevice}',2);COMMIT;`);
await ready(selection,true);revoker.commit();
const [revoked,denied]=await Promise.all([revoker.promise,selection.promise]);
assert.equal(revoked.code,0,revoked.stderr);assert.notEqual(denied.code,0);assert.match(denied.stderr,/MESH_ACCOUNT_DEVICE_UNAVAILABLE/);
assert.equal(query(`SELECT main_device_id||':'||revision FROM katosync.mesh_account_network WHERE owner_user_id='${owner}'`),secondDevice+":2");
console.log("ACCOUNT_NETWORK_REVOKE_BEFORE_SELECTION_DENIED_PASS");

query(`UPDATE katosync.mesh_devices SET membership_state='discovered',revoked_at=NULL WHERE device_id='${firstDevice}'`);
const chosen=launch(`BEGIN;${auth}SELECT katosync.mesh_account_network_set_primary('${firstDevice}',2);
 SELECT 'LOCKED_FOR_RACE';`,true);
await ready(chosen);
const laterRevoke=launch(`UPDATE katosync.mesh_devices SET membership_state='revoked',revoked_at=clock_timestamp() WHERE device_id='${firstDevice}'`);
await ready(laterRevoke,true);chosen.commit();
const [choice,revoke]=await Promise.all([chosen.promise,laterRevoke.promise]);
assert.equal(choice.code,0,choice.stderr);assert.equal(revoke.code,0,revoke.stderr);
const snapshot=query(`BEGIN;${auth}SELECT katosync.mesh_account_network_get();COMMIT;`).split("\n").filter(line=>line.startsWith("{")).at(-1);
const value=JSON.parse(snapshot);
assert.equal(value.mainDeviceId,firstDevice);assert.equal(value.mainDeviceAvailable,false);assert.equal(value.accountRevision,3);
console.log("ACCOUNT_NETWORK_LATER_REVOKE_BLOCKS_SELECTED_MAIN_PASS");
