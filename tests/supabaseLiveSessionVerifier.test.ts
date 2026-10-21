import assert from "node:assert/strict";
import test from "node:test";
import { makeLiveSupabaseSessionVerifier } from "../server/security/supabaseLiveSessionVerifier.ts";
import { TrustedApprovalBroker, signedApprovalPayload } from "../server/security/trustedApprovalBroker.ts";
import { generateKeyPairSync, sign } from "node:crypto";

const ORIGIN="https://isolated-qa.supabase.co";
const USER="11111111-1111-4111-8111-111111111111";
const SESSION="22222222-2222-4222-8222-222222222222";
const NOW=1_800_000_000_000;
const TOKEN_HEAD=Buffer.from(JSON.stringify({alg:"fake-test-only",typ:"JWT"})).toString("base64url");
function token(claimOverrides={}){
  const claims={sub:USER,session_id:SESSION,role:"authenticated",aud:"authenticated",
    iss:ORIGIN+"/auth/v1",exp:Math.floor(NOW/1000)+3600,...claimOverrides};
  return TOKEN_HEAD+"."+Buffer.from(JSON.stringify(claims)).toString("base64url")+".fake-signature";
}
function fixture(){
  const state={dbActive:true,apiOk:true,networkError:false,anonymous:false,redirected:false,
    userId:USER,rows:[],calls:[],now:NOW,apiKey:"sb_publishable_synthetic-test"};
  const fetchImpl=async (url,options)=>{
    state.calls.push({url,options});
    if(state.networkError)throw new Error("synthetic network unavailable");
    return {ok:state.apiOk,redirected:state.redirected,json:async()=>({id:state.userId,is_anonymous:state.anonymous})};
  };
  const sql={async query(queryText,parameters){
    state.rows.push({queryText,parameters});
    return [{active:state.dbActive}];
  }};
  const auth=makeLiveSupabaseSessionVerifier({
    projectOrigin:ORIGIN,publishableKey:state.apiKey,sql,
    now:()=>state.now,fetchImpl,
  });
  return {auth,state};
}

test("verified GoTrue /user response + live auth.sessions row yields scoped session",async()=>{
  const f=fixture();
  const result=await f.auth.verifyUserAccessToken(token());
  assert.deepEqual(result,{userId:USER,sessionId:SESSION,anonymous:false,expiresAtMs:NOW+3600000});
  assert.equal(f.state.calls.length,1);
  const c=f.state.calls[0];
  assert.equal(c.url,ORIGIN+"/auth/v1/user");
  assert.equal(c.options.headers.Authorization,"Bearer "+token());
  assert.equal(c.options.headers.apikey,"sb_publishable_synthetic-test");
  assert.equal(c.options.cache,"no-store");
  assert.equal(c.options.redirect,"error");
  assert.equal(f.state.rows.length,1);
  assert.deepEqual(f.state.rows[0].parameters,[SESSION,USER]);
  assert.match(f.state.rows[0].queryText,/auth[.]sessions/);
  assert.match(f.state.rows[0].queryText,/\$1::uuid/);
  assert.match(f.state.rows[0].queryText,/\$2::uuid/);
});
test("inactive or revoked database session is rejected despite valid Auth response",async()=>{
  const f=fixture();f.state.dbActive=false;
  assert.equal(await f.auth.verifyUserAccessToken(token()),null);
});
test("Auth API failure, redirect and timeout fail closed without DB access",async()=>{
  for(const change of [{apiOk:false},{redirected:true},{networkError:true}]){
    const f=fixture();Object.assign(f.state,change);
    assert.equal(await f.auth.verifyUserAccessToken(token()),null);
    assert.equal(f.state.rows.length,0);
  }
});
test("malicious origin / path / port / credentials cannot receive bearer token",()=>{
  for(const origin of [
    "http://isolated-qa.supabase.co",
    "https://isolated-qa.supabase.co@evil.example",
    "https://isolated-qa.supabase.co:8443",
    "https://isolated-qa.supabase.co/evil",
    "https://isolated-qa.supabase.co.evil.example",
    "https://localhost",
  ]){
    assert.throws(()=>makeLiveSupabaseSessionVerifier({
      projectOrigin:origin,publishableKey:"sb_publishable_test",sql:{async query(){return []}},
    }));
  }
});
test("untrusted JWT payload alone never validates without server-side Auth success",async()=>{
  const f=fixture();f.state.apiOk=false;
  assert.equal(await f.auth.verifyUserAccessToken(token()),null);
  assert.equal(f.state.rows.length,0);
});
test("mismatched returned user identity is denied before SQL",async()=>{
  const f=fixture();f.state.userId="33333333-3333-4333-8333-333333333333";
  assert.equal(await f.auth.verifyUserAccessToken(token()),null);
  assert.equal(f.state.rows.length,0);
});
test("expired/missing session, issuer, audience and role claims are refused",async()=>{
  const cases=[
    {exp:Math.floor(NOW/1000)-1},{session_id:null},{session_id:"not-a-uuid"},
    {iss:"https://evil.example/auth/v1"},{role:"service_role"},{aud:"service_role"},
    {sub:"44444444-4444-4444-8444-444444444444"},
  ];
  for(const claims of cases){
    const f=fixture();
    assert.equal(await f.auth.verifyUserAccessToken(token(claims)),null);
    assert.equal(f.state.rows.length,0);
  }
});
test("anonymous GoTrue user rejected even with authenticated-looking claims",async()=>{
  const f=fixture();f.state.anonymous=true;
  assert.equal(await f.auth.verifyUserAccessToken(token()),null);
});
test("invalid bearer tokens and corrupt JSON fail without authorization",async()=>{
  const f=fixture();
  assert.equal(await f.auth.verifyUserAccessToken("malformed"),null);
  const encoded=TOKEN_HEAD+".not-json."+("a".repeat(64));
  assert.equal(await f.auth.verifyUserAccessToken(encoded),null);
  assert.equal(f.state.rows.length,0);
});
test("live session expiration tracks trusted JWT expiry without local extension",async()=>{
  const f=fixture();
  const claims={exp:Math.floor(NOW/1000)+9};
  assert.equal((await f.auth.verifyUserAccessToken(token(claims)))?.expiresAtMs,NOW+9000);
  f.state.now+=9200;
  assert.equal(await f.auth.verifyUserAccessToken(token(claims)),null);
});
test("Supabase-backed session verifies at broker boundary; signer still must be owned",async()=>{
  const f=fixture();
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const acct="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const signer="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const executor="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const taskId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  let deviceOwned=true, savedGrant=null;
  const challengeStore=new Map();
  const req={accountId:acct,projectId:"project-a",taskId,executorDeviceId:executor,
    approverDeviceId:signer,expectedHead:"a".repeat(40),scope:"edit_worktree"};
  const broker=new TrustedApprovalBroker({
    auth:f.auth,
    now:()=>f.state.now,
    policy:{
      async canApprove(user,account,project){return user===USER && account===acct && project==="project-a"},
      async canUseApproverDevice(user,account,device){
        return deviceOwned && user===USER && account===acct && device===signer;
      },
      async registeredDevice(account,device){
        if(account!==acct || ![signer,executor].includes(device))return null;
        return {accountId:acct,deviceId:device,trusted:true,revoked:false,
          publicKeyPem:publicKey.export({type:"spki",format:"pem"}).toString()};
      },
    },
    challenges:{
      async store(c){challengeStore.set(c.challengeId,c)},
      async consume(id,user,session){
        const c=challengeStore.get(id);
        if(!c || c.userId!==user || c.sessionId!==session)return null;
        challengeStore.delete(id);return c;
      },
    },
    approvals:{async create(g){savedGrant=g}},
  });
  const c=await broker.issueChallenge(token(),req);
  const signature=sign(null,signedApprovalPayload(c),privateKey).toString("base64url");
  const grant=await broker.approve(token(),req,"APPROVE_THIS_TASK",c.challengeId,signature);
  assert.equal(savedGrant?.approvalId,grant.approvalId);
  assert.equal(grant.approvedBy,USER);
  deviceOwned=false;
  await assert.rejects(broker.issueChallenge(token(),req));
});

test("service role or malformed project API keys are rejected at construction",()=>{
  for(const key of ["", "service_role", "sb_secret_serverkey", "eyJhbGciOi", "sb_publishable_short"]){
    assert.throws(()=>makeLiveSupabaseSessionVerifier({
      projectOrigin:ORIGIN,publishableKey:key,
      sql:{async query(){return []}},
    }));
  }
});
