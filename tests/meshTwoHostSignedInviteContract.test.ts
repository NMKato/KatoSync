// NMKato Solutions — Stage 2U safety contract for manual, real-LAN synthetic QA.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const script=new URL("../scripts/qa-mesh-two-host-signed-invite.mjs",import.meta.url);
const shell=new URL("../scripts/qa-mesh-two-host-signed-invite-server.sh",import.meta.url);
const src=readFileSync(script,"utf8"),server=readFileSync(shell,"utf8");
test("real-host QA client refuses accidental startup before opening any socket",()=>{
 const r=spawnSync(process.execPath,[script.pathname],{
  encoding:"utf8",timeout:3000,
  env:{PATH:process.env.PATH??"",HOME:"/tmp"}
 });
 assert.equal(r.status,2);
 assert.match(r.stderr,/MESH_TWO_HOST_BLOCKED:SYNTHETIC_LAN_OPT_IN/);
});
test("server helper refuses without explicit synthetic gate before creating a certificate",()=>{
 const r=spawnSync("bash",[shell.pathname],{
  encoding:"utf8",timeout:3000,
  env:{PATH:process.env.PATH??"",HOME:"/tmp"}
 });
 assert.equal(r.status,2);
 assert.match(r.stderr,/MESH_TWO_HOST_BLOCKED: explicit synthetic/);
});
test("short-lived TLS 1.3 pinned, Ed25519 double signature, never grants trust",()=>{
 for(const needed of [
  "SYNTHETIC_FIXTURES_ONLY","client-wrong-pin","KATOSYNC_MESH_LAN_QA_WRONG_PIN",
  "KATOSYNC_MESH_LAN_QA_CERT_PIN","getPeerCertificate(true).raw",
  "createHash(\"sha256\")","TLSv1.3","offer.signature","dispatchSignature",
  "signed-recipient-ack","MESH_TWO_HOST_WRONG_CERT_PIN_REJECTED",
  "MESH_TWO_HOST_QA_RECEIPT_VERIFIED","MESH_TWO_HOST_SYNTHETIC_ED25519_ACK_VERIFIED",
  "socket.remoteAddress","MESH_TWO_HOST_UNKNOWN_PEER","MESH_TWO_HOST_TIMEOUT",
  "remoteJobsEnabled:false","paired:false","transportReady:false",
  "expiresAt*1000<=Date.now()","validSig("])
  assert.ok(src.includes(needed),"Missing real-host guard "+needed);
 assert.match(src,/PORT!==49331/);
 assert.match(src,/OWN===PEER/);
 assert.doesNotMatch(src,/SUPABASE_SERVICE_ROLE_KEY|security find-generic-password/);
 assert.match(server,/mktemp -d \/tmp\/ksmesh2u/);
 assert.match(server,/trap cleanup EXIT INT TERM/);
 assert.match(server,/-days 1/);
 assert.match(server,/umask 077/);
});
