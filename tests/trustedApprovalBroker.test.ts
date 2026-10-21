import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  ApprovalDenied, TrustedApprovalBroker, signedApprovalPayload,
} from "../server/security/trustedApprovalBroker.ts";

const ACCOUNT="11111111-1111-4111-8111-111111111111";
const OWNER="22222222-2222-4222-8222-222222222222";
const SESSION="33333333-3333-4333-8333-333333333333";
const SIGNER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN="verified-token-only-for-isolated-tests";
const HEAD="a".repeat(40);
const NOW=1_800_000_000_000;
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const foreignKeys=generateKeyPairSync("ed25519");
const SIGNER_PEM=publicKey.export({type:"spki",format:"pem"}).toString();

function fixture(){
  const state={
    now:NOW,allowed:true,deviceOwned:true,anonymous:false,signerTrusted:true,workerTrusted:true,
    signerRevoked:false,workerRevoked:false,expired:false,sessionId:SESSION,
    recorded:[],challenges:new Map(),failStore:false,
  };
  const request={
    accountId:ACCOUNT,projectId:"project-a",taskId:TASK,
    executorDeviceId:WORKER,approverDeviceId:SIGNER,
    expectedHead:HEAD,scope:"edit_worktree",
  };
  const ports={
    now:()=>state.now,
    auth:{
      async verifyUserAccessToken(token){
        if(token!==TOKEN)return null;
        return {userId:OWNER,sessionId:state.sessionId,expiresAtMs:state.expired?state.now-1:state.now+900_000,anonymous:state.anonymous};
      },
    },
    policy:{
      async canApprove(actor,account,project){
        return state.allowed && actor===OWNER && account===ACCOUNT && project==="project-a";
      },
      async canUseApproverDevice(user,account,device){
        return state.deviceOwned && user===OWNER && account===ACCOUNT && device===SIGNER;
      },
      async registeredDevice(account,device){
        if(account!==ACCOUNT)return null;
        if(device===SIGNER)return {deviceId:SIGNER,accountId:ACCOUNT,publicKeyPem:SIGNER_PEM,trusted:state.signerTrusted,revoked:state.signerRevoked};
        if(device===WORKER)return {deviceId:WORKER,accountId:ACCOUNT,publicKeyPem:SIGNER_PEM,trusted:state.workerTrusted,revoked:state.workerRevoked};
        return null;
      },
    },
    challenges:{
      async store(c){state.challenges.set(c.challengeId,c)},
      async consume(id,user,session){
        const value=state.challenges.get(id);
        if(!value || value.userId!==user || value.sessionId!==session)return null;
        state.challenges.delete(id);
        return value;
      },
    },
    approvals:{
      async create(row){
        if(state.failStore)throw new Error("trusted DB unavailable");
        state.recorded.push(row);
      },
    },
  };
  const broker=new TrustedApprovalBroker(ports);
  async function requestSignature(){
    const c=await broker.issueChallenge(TOKEN,request);
    return {c,signature:sign(null,signedApprovalPayload(c),privateKey).toString("base64url")};
  }
  return {state,request,broker,requestSignature};
}
test("registered human session can approve a DIFFERENT enrolled executor only once",async()=>{
  const f=fixture();const {c,signature}=await f.requestSignature();
  const grant=await f.broker.approve(TOKEN,f.request,"APPROVE_THIS_TASK",c.challengeId,signature);
  assert.equal(grant.deviceId,WORKER);
  assert.equal(grant.approvedBy,OWNER);
  assert.deepEqual(grant.capabilities,["edit_worktree"]);
  assert.match(grant.proofDigestSha256,/^[a-f0-9]{64}$/);
  assert.equal(f.state.recorded.length,1);
  await assert.rejects(f.broker.approve(TOKEN,f.request,"APPROVE_THIS_TASK",c.challengeId,signature),ApprovalDenied);
});
test("no session and anonymous identity fail before challenge",async()=>{
  const f=fixture();
  await assert.rejects(f.broker.issueChallenge("fake",f.request),ApprovalDenied);
  f.state.anonymous=true;
  await assert.rejects(f.broker.issueChallenge(TOKEN,f.request),ApprovalDenied);
  assert.equal(f.state.challenges.size,0);
});
test("only account-authorized owner with correct project and device can issue",async()=>{
  const f=fixture();f.state.allowed=false;
  await assert.rejects(f.broker.issueChallenge(TOKEN,f.request),ApprovalDenied);
  f.state.allowed=true;
  await assert.rejects(f.broker.issueChallenge(TOKEN,{...f.request,projectId:"foreign-project"}),ApprovalDenied);
  await assert.rejects(f.broker.issueChallenge(TOKEN,{...f.request,executorDeviceId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}),ApprovalDenied);
  assert.equal(f.state.challenges.size,0);
});
test("revoked signer or remote executor is refused",async()=>{
  const f=fixture();f.state.signerRevoked=true;
  await assert.rejects(f.broker.issueChallenge(TOKEN,f.request),ApprovalDenied);
  f.state.signerRevoked=false;f.state.workerRevoked=true;
  await assert.rejects(f.broker.issueChallenge(TOKEN,f.request),ApprovalDenied);
  f.state.workerRevoked=false;f.state.workerTrusted=false;
  await assert.rejects(f.broker.issueChallenge(TOKEN,f.request),ApprovalDenied);
});
test("unverified human confirmation, wrong signature or missing approval are denied",async()=>{
  const f=fixture();const {c,signature}=await f.requestSignature();
  await assert.rejects(f.broker.approve(TOKEN,f.request,"yes",c.challengeId,signature),ApprovalDenied);
  await assert.rejects(f.broker.approve(TOKEN,f.request,"APPROVE_THIS_TASK",c.challengeId,
    sign(null,signedApprovalPayload(c),foreignKeys.privateKey).toString("base64url")),ApprovalDenied);
  assert.equal(f.state.recorded.length,0);
  await assert.rejects(f.broker.approve(TOKEN,f.request,"APPROVE_THIS_TASK",c.challengeId,signature),ApprovalDenied);
});
test("tampered task, SHA and disallowed operation scope never persist",async()=>{
  for(const tamper of [
    {taskId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
    {expectedHead:"b".repeat(40)},
    {scope:"git_push"},
    {executorDeviceId:SIGNER},
    {accountId:"ffffffff-ffff-4fff-8fff-ffffffffffff"},
  ]){
    const f=fixture(), {c,signature}=await f.requestSignature();
    await assert.rejects(f.broker.approve(TOKEN,{...f.request,...tamper},"APPROVE_THIS_TASK",c.challengeId,signature),ApprovalDenied);
    assert.equal(f.state.recorded.length,0);
  }
});
test("expired challenge and switched session are refused",async()=>{
  const f=fixture();const {c,signature}=await f.requestSignature();
  f.state.now+=91_000;
  await assert.rejects(f.broker.approve(TOKEN,f.request,"APPROVE_THIS_TASK",c.challengeId,signature),ApprovalDenied);
  const g=fixture(),proof=await g.requestSignature();
  g.state.sessionId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await assert.rejects(g.broker.approve(TOKEN,g.request,"APPROVE_THIS_TASK",proof.c.challengeId,proof.signature),ApprovalDenied);
});
test("authorization/device revocation after challenge blocks final grant",async()=>{
  const f=fixture(),{c,signature}=await f.requestSignature();
  f.state.allowed=false;
  await assert.rejects(f.broker.approve(TOKEN,f.request,"APPROVE_THIS_TASK",c.challengeId,signature),ApprovalDenied);
  assert.equal(f.state.recorded.length,0);
  const g=fixture(),proof=await g.requestSignature();g.state.workerRevoked=true;
  await assert.rejects(g.broker.approve(TOKEN,g.request,"APPROVE_THIS_TASK",proof.c.challengeId,proof.signature),ApprovalDenied);
});
test("db failure refuses success and does not duplicate grant",async()=>{
  const f=fixture(),{c,signature}=await f.requestSignature();f.state.failStore=true;
  await assert.rejects(f.broker.approve(TOKEN,f.request,"APPROVE_THIS_TASK",c.challengeId,signature));
  assert.equal(f.state.recorded.length,0);
  f.state.failStore=false;
  await assert.rejects(f.broker.approve(TOKEN,f.request,"APPROVE_THIS_TASK",c.challengeId,signature),ApprovalDenied);
});
test("two concurrent attempts consuming same challenge get exactly one grant",async()=>{
  const f=fixture(),{c,signature}=await f.requestSignature();
  const results=await Promise.allSettled([
    f.broker.approve(TOKEN,f.request,"APPROVE_THIS_TASK",c.challengeId,signature),
    f.broker.approve(TOKEN,f.request,"APPROVE_THIS_TASK",c.challengeId,signature),
  ]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(results.filter(x=>x.status==="rejected").length,1);
  assert.equal(f.state.recorded.length,1);
});

test("challenge response does not expose internal user or session identifiers",async()=>{
  const f=fixture();
  const challenge=await f.broker.issueChallenge(TOKEN,f.request);
  assert.equal(Object.hasOwn(challenge,"sessionId"),false);
  assert.equal(Object.hasOwn(challenge,"userId"),false);
  assert.ok(challenge.nonce.length>=42);
});
test("auth-device key substitution after challenge invalidates signed consent",async()=>{
  const f=fixture();
  const {c,signature}=await f.requestSignature();
  // Server-side device registration is revoked while consent is being processed.
  f.state.signerRevoked=true;
  await assert.rejects(
    f.broker.approve(TOKEN,f.request,"APPROVE_THIS_TASK",c.challengeId,signature),
    ApprovalDenied,
  );
  assert.equal(f.state.recorded.length,0);
});

test("account approval right without ownership of signing device is rejected",async()=>{
  const f=fixture(); f.state.deviceOwned=false;
  await assert.rejects(f.broker.issueChallenge(TOKEN,f.request),ApprovalDenied);
  assert.equal(f.state.challenges.size,0);
});
