import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createOwnerReviewReadbackSessionClient} from
  "../src/lib/ownerReviewReadbackClient40.ts";

const owner="22222222-2222-4222-8222-222222222222";
const other="99999999-9999-4999-8999-999999999999";
const decisionId="55555555-5555-4555-8555-555555555555";
const grantId="33333333-3333-4333-8333-333333333333";
const expected={
  protocol:"katosync.native-owner-review-readback-qa/v1",
  status:"server_attested_unverified",
  ownerAuthenticated:true,serverAttestationReceived:true,
  independentReviewerVerified:false,grantsRights:false,
  verifiedPercent:null,remoteJobsEnabled:false
};
const session=(sessionKey="katoos-owner-epoch-synthetic-0001",expectedOwnerUid=owner)=>
  ({sessionKey,expectedOwnerUid});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("not mounted or invoked by default; there are no user JWTs in the renderer",async()=>{
  let calls=0;
  const client=createOwnerReviewReadbackSessionClient({invokeNative:async()=>{
    calls++;return expected;
  }});
  assert.deepEqual(client.snapshot(),{
    status:"disconnected",serverEvidencePresent:false,
    grantsRights:false,verifiedPercent:null
  });
  await client.readback(decisionId,grantId);
  assert.equal(calls,0);
  client.attach(session());
  assert.equal(client.snapshot().status,"unavailable");
  assert.equal(calls,0);
  // No raw KATOOS access tokens are accepted in the public session interface.
  const moduleText=readFileSync(new URL("../src/lib/ownerReviewReadbackClient40.ts",
    import.meta.url),"utf8");
  assert.doesNotMatch(moduleText,/\bgetAccessToken\s*:/);
  assert.doesNotMatch(moduleText,/\bfetch\(/);
  assert.doesNotMatch(moduleText,/\blocalStorage\b\s*\./);
  assert.doesNotMatch(moduleText,/\bsessionStorage\b\s*\./);
  assert.match(moduleText,/invoke<unknown>\("mesh_owner_review_readback_qa",\{/);
});

test("native QA command receives only exact decision, grant and expected UID",async()=>{
  const calls=[];
  const client=createOwnerReviewReadbackSessionClient({invokeNative:async args=>{
    calls.push(args);return expected;
  }});
  client.attach(session());
  const statuses=[];client.subscribe(s=>statuses.push(s.status));
  const snapshot=await client.readback(decisionId,grantId);
  assert.deepEqual(calls,[{decisionId,grantId,expectedOwnerUid:owner}]);
  assert.deepEqual(snapshot,{
    status:"server_attested_unverified",serverEvidencePresent:true,
    grantsRights:false,verifiedPercent:null
  });
  assert.deepEqual(statuses,["unavailable","loading","server_attested_unverified"]);
  assert.equal(Object.hasOwn(snapshot,"reviewerSignature"),false);
  assert.equal(Object.hasOwn(snapshot,"accessToken"),false);
});

test("synthetic server evidence NEVER changes independent Reviewer permission",async()=>{
  const client=createOwnerReviewReadbackSessionClient({
    invokeNative:async()=>expected
  });
  client.attach(session());
  const value=await client.readback(decisionId,grantId);
  assert.equal(value.status,"server_attested_unverified");
  assert.equal(value.grantsRights,false);
  assert.equal(value.verifiedPercent,null);
  assert.equal(value.serverEvidencePresent,true);
});

test("renderer cannot trick native about reviewed UID by injecting extra fields",async()=>{
  for(const changed of [
    {...expected,grantsRights:true},
    {...expected,verifiedPercent:100},
    {...expected,independentReviewerVerified:true},
    {...expected,remoteJobsEnabled:true},
    {...expected,ownerAuthenticated:false},
    {...expected,status:"approved"},
    {...expected,reviewerSignature:"SENSITIVE_PROOF"},
    {...expected,protocol:"other"},
    {...expected,serverAttestationReceived:false},
    {},
    null,
  ]){
    const client=createOwnerReviewReadbackSessionClient({
      invokeNative:async()=>changed
    });
    client.attach(session());
    assert.deepEqual(await client.readback(decisionId,grantId),{
      status:"unavailable",serverEvidencePresent:false,
      grantsRights:false,verifiedPercent:null
    });
  }
});

test("invalid owner or IDs reject before any native invocation",async()=>{
  let count=0;
  const client=createOwnerReviewReadbackSessionClient({
    invokeNative:async()=>{count++;return expected;}
  });
  for(const bad of [null,{},{sessionKey:"short",expectedOwnerUid:owner},
    session("valid-owner", "not-a-uuid"),
    {sessionKey:123,expectedOwnerUid:owner}
  ])assert.throws(()=>client.attach(bad),/INVALID_EXISTING_KATOOS_SESSION/);
  client.attach(session());
  await assert.rejects(()=>client.readback("incorrect",grantId),/INVALID_REVIEW_REFERENCE/);
  await assert.rejects(()=>client.readback(decisionId,"incorrect"),/INVALID_REVIEW_REFERENCE/);
  assert.equal(count,0);
});

test("native login rejection and account mismatch return unauthorized without evidence",async()=>{
  for(const err of ["GATE10_NATIVE_LOGIN_REQUIRED","GATE10_NATIVE_OWNER_CHANGED"]){
    const client=createOwnerReviewReadbackSessionClient({
      invokeNative:async()=>{throw new Error(err);}
    });
    client.attach(session());
    assert.equal((await client.readback(decisionId,grantId)).status,"unauthorized");
    assert.equal(client.snapshot().serverEvidencePresent,false);
  }
});

test("unavailable QA server does not infer signed review or cached authority",async()=>{
  const client=createOwnerReviewReadbackSessionClient({
    invokeNative:async()=>{throw new Error("GATE10_NATIVE_QA_DISABLED");}
  });
  client.attach(session());
  assert.deepEqual(await client.readback(decisionId,grantId),{
    status:"unavailable",serverEvidencePresent:false,
    grantsRights:false,verifiedPercent:null
  });
});

test("logout while native request is pending drops late results",async()=>{
  let resolve;
  const pending=new Promise(r=>{resolve=r;});
  const client=createOwnerReviewReadbackSessionClient({
    invokeNative:async()=>pending
  });
  client.attach(session());
  const attempt=client.readback(decisionId,grantId);
  client.disconnect();
  resolve(expected);
  await attempt;
  assert.deepEqual(client.snapshot(),{
    status:"disconnected",serverEvidencePresent:false,
    grantsRights:false,verifiedPercent:null
  });
});

test("KATOOS account switch discards old native proof and does not authorize new account",async()=>{
  let resolve;
  const pending=new Promise(r=>{resolve=r;});
  let seen;
  const client=createOwnerReviewReadbackSessionClient({
    invokeNative:async(args)=>{seen=args;return pending;}
  });
  client.attach(session());
  const attempt=client.readback(decisionId,grantId);
  for(let i=0;i<5&&!seen;i++)await tick();
  assert.equal(seen.expectedOwnerUid,owner);
  client.attach(session("synthetic-new-katoos-session",other));
  resolve(expected);
  await attempt;
  assert.deepEqual(client.snapshot(),{
    status:"unavailable",serverEvidencePresent:false,
    grantsRights:false,verifiedPercent:null
  });
});

test("a new readback clears old untrusted evidence before native command",async()=>{
  let denied=false;
  const client=createOwnerReviewReadbackSessionClient({
    invokeNative:async()=>denied?Promise.reject("GATE10_NATIVE_LOGIN_REQUIRED"):expected
  });
  client.attach(session());
  assert.equal((await client.readback(decisionId,grantId)).serverEvidencePresent,true);
  denied=true;
  const after=await client.readback(decisionId,grantId);
  assert.deepEqual(after,{
    status:"unauthorized",serverEvidencePresent:false,
    grantsRights:false,verifiedPercent:null
  });
});

test("observers never affect success, logout or unsubscribe",async()=>{
  const client=createOwnerReviewReadbackSessionClient({
    invokeNative:async()=>expected
  });
  let updates=0;
  const remove=client.subscribe(()=>{updates++;throw Error("bad UI");});
  client.attach(session());
  await client.readback(decisionId,grantId);
  assert.equal(client.snapshot().status,"server_attested_unverified");
  assert.equal(updates,4);
  remove();
  client.disconnect();
  assert.equal(updates,4);
});

test("Tauri runtime command is feature+stage gated and never exports bearer",()=>{
  const rust=readFileSync(new URL("../src-tauri/src/mesh_owner_review_readback.rs",
    import.meta.url),"utf8");
  const commands=readFileSync(new URL("../src-tauri/src/lib.rs",
    import.meta.url),"utf8");
  assert.match(rust,/cfg!\(feature = "katoos-auth-qa"\)/);
  assert.match(rust,/KATOSYNC_FEATURE_APPROVAL_STAGE/);
  assert.match(rust,/verified_katosync_user\(\)/);
  assert.match(rust,/ensure_supabase_access_token\(\)/);
  assert.match(rust,/same_account_still_verified\(&owner\)/);
  assert.match(rust,/Zeroizing::new/);
  assert.match(rust,/ENDPOINT/);
  assert.match(rust,/\.post\(ENDPOINT\)/);
  assert.match(rust,/\.redirect\(reqwest::redirect::Policy::none\(\)\)/);
  assert.match(commands,/mesh_owner_review_readback::mesh_owner_review_readback_qa,/);
  assert.doesNotMatch(rust,/save_supabase_refresh_token|save_api_key\(|execute.*command\(|\.grant.*=true/);
});
