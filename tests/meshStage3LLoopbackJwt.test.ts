// NMKato Solutions – cross-platform cryptographic 127.0.0.1 JWT gateway QA.
// Never sends or accepts real KATOOS credentials.
import {test} from "node:test";
import assert from "node:assert/strict";
import {startStage3LLoopbackGateway} from "./meshStage3LLoopbackGateway.qa.ts";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const OWNER="11111111-1111-4111-8111-111111111111";
test("Stage 3L synthetic signed-JWT gateway permits only valid auth on HTTP loopback",async()=>{
 const backend:typeof fetch=async()=>Response.json([]);
 const gate=await startStage3LLoopbackGateway(backend,ORIGIN,OWNER);
 const fetchUser=(jwt:string)=>gate.request(ORIGIN+"/auth/v1/user",
  {headers:{Authorization:"Bearer "+jwt}});
 try{
  const valid=await fetchUser(gate.tokenFor(OWNER));
  assert.equal(valid.status,200);
  assert.equal((await valid.json()).id,OWNER);
  const expired=await fetchUser(gate.tokenFor(OWNER,-20));
  assert.equal(expired.status,401);
  const raw=gate.tokenFor(OWNER);
  const forged=raw.slice(0,-1)+(raw.endsWith("A")?"B":"A");
  assert.equal((await fetchUser(forged)).status,401);
  // A 32-byte HMAC has 2 unused bits in its last Base64URL character.
  // Mutating only those bits preserves the decoded signature bytes, but
  // must NOT be accepted as a canonical representation of that token.
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last=raw.at(-1)??"";
  const index=alphabet.indexOf(last);
  assert.ok(index>=0);
  const alias=raw.slice(0,-1)+alphabet[index^1];
  assert.notEqual(alias,raw);
  assert.deepEqual(Buffer.from(alias.split(".").at(-1)??"","base64url"),
   Buffer.from(raw.split(".").at(-1)??"","base64url"));
  assert.equal((await fetchUser(alias)).status,401,"noncanonical Base64URL signature must be rejected");
  assert.equal((await gate.request(ORIGIN+"/rest/v1/mesh_devices")).status,403);
  assert.equal((await gate.request(ORIGIN+"/unrecognized")).status,404);
  await assert.rejects(gate.request("https://elsewhere.invalid/auth/v1/user"),/STAGE3L_NO_EXTERNAL_NETWORK/);
  assert.equal(gate.counts.dbCalls,0);
 }finally{
  await gate.close();
 }
});
test("Stage 3L runtime rejects accidental execution without existing Cargo target",()=>{
 const entry=fileURLToPath(new URL("../scripts/qa-mesh-rust-postgres-stage3k.mjs",import.meta.url));
 const p=spawnSync(process.execPath,[entry],{
  env:{PATH:process.env.PATH??"",HOME:process.env.HOME??"",
   KATOSYNC_STAGE3L_LOOPBACK:"SIGNED_LOCAL_ONLY"},
  encoding:"utf8",timeout:5000,
 });
 assert.notEqual(p.status,0);
 assert.match(p.stderr,process.platform==="darwin"?
  /STAGE3K_REQUIRES_EXISTING_CARGO_TARGET_DIR/:/STAGE3K_MACOS_PG17_QA_ONLY/);
});
