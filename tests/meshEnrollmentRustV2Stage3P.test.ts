// Stage 3P: cross-language Ed25519 contract, offline-only.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseEnrollmentV2,verifyEnrollmentV2} from "../supabase/functions/mesh-enrollment-preview/protocol.ts";
const raw=readFileSync(new URL("./fixtures/meshEnrollmentRustV2Stage3P.public.json",import.meta.url),"utf8");
const f=JSON.parse(raw);
const QA="https://abcdefghijklmnopqrst.supabase.co";
const PROD="https://xbnnlyyxiilklsygxcof.supabase.co";
const row={challenge_id:f.proof.challengeId,owner_user_id:f.owner,
 signing_public_key:f.proof.publicKey,nonce:f.proof.nonce,
 expires_at:f.proof.expiresAt,consumed_at:null};
const verify=(p:unknown,origin=QA,r=row,owner=f.owner)=>
 verifyEnrollmentV2(p as typeof f.proof,owner,origin,r,f.nowMs);
test("fixture is public-only Rust/Serde signature",()=>{
 assert.equal(f.fixtureOnly,true);
 assert.equal(f.generatedBy,"rust-ed25519-serde-test");
 assert.equal(f.origin,QA);
 assert.deepEqual(parseEnrollmentV2(f.proof),f.proof);
 assert.doesNotMatch(raw,/privateKey|signingSeed|secretKey|password/i);
});
test("signed proof verifies on isolated tenant only",async()=>{
 assert.equal(await verify(f.proof),true);
 assert.equal(await verify(f.proof,PROD),false);
 assert.equal(await verify({...f.proof,origin:PROD},PROD),false);
 assert.equal(await verify(f.proof,QA,{...row,consumed_at:"2033-01-01T00:00:00Z"}),false);
});
test("mutated device metadata, time and signature fail",async()=>{
 for(const patch of [{deviceName:"Other Mac"},{platformOs:"windows"},
  {nonce:"A".repeat(43)},{expiresAt:"2033-01-01T00:00:00Z"},
  {signature:"A".repeat(86)},{protocol:"katosync-mesh-enrollment-proof-v1"}]){
  assert.equal(await verify({...f.proof,...patch}),false,JSON.stringify(patch));
 }
 assert.equal(await verify(f.proof,QA,{...row,owner_user_id:"99999999-9999-4999-8999-999999999999"}),false);
});
test("strict field and time handling",async()=>{
 assert.equal(parseEnrollmentV2({...f.proof,extra:true}),null);
 assert.equal(parseEnrollmentV2({...f.proof,deviceName:"Unsafe<name>"}),null);
 assert.equal(await verifyEnrollmentV2(f.proof,f.owner,QA,row,f.nowMs+120000),false);
 assert.equal(await verifyEnrollmentV2(f.proof,f.owner,QA,row,f.nowMs-120000),false);
});
