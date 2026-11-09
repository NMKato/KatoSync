// NMKato Solutions — Stage 3N Rust ed25519-dalek -> Edge WebCrypto contract.
// Checked-in fixture contains PUBLIC Rust-signed proof only, never seed/key material.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseRelayListProof,verifyRelayListProof,RELAY_LIST_PROTOCOL_V2} from
 "../supabase/functions/mesh-pairing-relay/protocol.ts";
const fixturePath=process.env.KATOSYNC_STAGE3N_RUST_V2_FIXTURE??
 new URL("./fixtures/meshRelayRustListV2Stage3N.public.json",import.meta.url);
const raw=readFileSync(fixturePath,"utf8");
const f=JSON.parse(raw);
const QA="https://abcdefghijklmnopqrst.supabase.co";
const PROD="https://xbnnlyyxiilklsygxcof.supabase.co";
test("Rust-generated public v2 fixture contains correct tenant binding and no secret fields",()=>{
 assert.equal(f.fixtureOnly,true);
 assert.equal(f.generatedBy,"rust-production-ed25519-dalek-serde");
 assert.equal(f.origin,QA);
 assert.equal(f.readProof.origin,QA);
 assert.equal(f.readProof.protocol,RELAY_LIST_PROTOCOL_V2);
 assert.doesNotMatch(raw,/privateKey|secretKey|signingSeed|refresh_token|service_role|password/i);
 assert.deepEqual(parseRelayListProof(f.readProof),f.readProof);
});
test("actual Rust ed25519-dalek v2 proof verifies in Edge WebCrypto ONLY on exact tenant",async()=>{
 const now=f.nowMs;
 assert.equal(await verifyRelayListProof(f.readProof,f.owner,f.publicKey,now,QA),true);
 assert.equal(await verifyRelayListProof(f.readProof,f.owner,f.publicKey,now,PROD),false);
 assert.equal(await verifyRelayListProof({...f.readProof,origin:PROD},f.owner,f.publicKey,now,PROD),false);
 assert.equal(await verifyRelayListProof({...f.readProof,nonce:"A".repeat(43)},f.owner,f.publicKey,now,QA),false);
 assert.equal(await verifyRelayListProof({...f.readProof,signature:"A".repeat(86)},f.owner,f.publicKey,now,QA),false);
 assert.equal(await verifyRelayListProof({...f.readProof,protocol:"katosync-mesh-pairing-relay-list-v1"},f.owner,f.publicKey,now,QA),false);
 assert.equal(await verifyRelayListProof(f.readProof,"99999999-9999-4999-8999-999999999999",f.publicKey,now,QA),false);
 assert.equal(await verifyRelayListProof(f.readProof,f.owner,f.publicKey,now+120_000,QA),false);
});
