import test from "node:test";
import assert from "node:assert/strict";
import { createDurableAuthorizationPorts } from "../server/security/durableAuthorizationPorts.ts";
const ACCOUNT="11111111-1111-4111-8111-111111111111";
const OWNER="22222222-2222-4222-8222-222222222222";
const DEVICE="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CHALLENGE="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const EXPIRES=1_800_000_060_000;
const challenge={
  challengeId:CHALLENGE,nonce:"a".repeat(43),accountId:ACCOUNT,
  projectId:"project-a",taskId:TASK,executorDeviceId:TARGET,
  approverDeviceId:DEVICE,expectedHead:"a".repeat(40),
  scope:"edit_worktree",userId:OWNER,sessionId:SESSION,expiresAtMs:EXPIRES,
};
function mock(rows){
 const calls=[];
 const db={
  async query(sql,params){
   calls.push({sql,params});
   return typeof rows==="function" ? rows(sql,params) : rows;
  },
 };
 return {ports:createDurableAuthorizationPorts(db),calls};
}
test("membership approval only accepts server-owned owner/approver row",async()=>{
 const good=mock([{allowed:true}]);
 assert.equal(await good.ports.policy.canApprove(OWNER,ACCOUNT,"project-a"),true);
 assert.match(good.calls[0].sql,/project_memberships/);
 assert.match(good.calls[0].sql,/revoked_at IS NULL/);
 assert.match(good.calls[0].sql,/role IN/);
 assert.deepEqual(good.calls[0].params,[OWNER,ACCOUNT,"project-a"]);
 const bad=mock([{allowed:false}]);
 assert.equal(await bad.ports.policy.canApprove(OWNER,ACCOUNT,"project-a"),false);
 assert.equal(await mock([]).ports.policy.canApprove(OWNER,ACCOUNT,"project-a"),false);
});
test("approving device lookup requires real signer owner and active trust",async()=>{
 const x=mock([{allowed:true}]);
 assert.equal(await x.ports.policy.canUseApproverDevice(OWNER,ACCOUNT,DEVICE),true);
 assert.match(x.calls[0].sql,/owner_user_id/);
 assert.match(x.calls[0].sql,/revoked_at IS NULL/);
 assert.deepEqual(x.calls[0].params,[OWNER,ACCOUNT,DEVICE]);
 assert.equal(await mock([{allowed:false}]).ports.policy.canUseApproverDevice(OWNER,ACCOUNT,DEVICE),false);
});
test("device lookup fails closed for foreign account/device or bad row",async()=>{
 const row={account_id:ACCOUNT,device_id:DEVICE,signing_public_key_pem:"synthetic",trusted:true,revoked:false};
 assert.deepEqual(await mock([row]).ports.policy.registeredDevice(ACCOUNT,DEVICE),
   {accountId:ACCOUNT,deviceId:DEVICE,publicKeyPem:"synthetic",trusted:true,revoked:false});
 assert.equal(await mock([{...row,account_id:"foreign"}]).ports.policy.registeredDevice(ACCOUNT,DEVICE),null);
 assert.equal(await mock([{...row,device_id:TARGET}]).ports.policy.registeredDevice(ACCOUNT,DEVICE),null);
 assert.equal(await mock([row,row]).ports.policy.registeredDevice(ACCOUNT,DEVICE),null);
 assert.equal(await mock([]).ports.policy.registeredDevice(ACCOUNT,DEVICE),null);
});
test("challenge insertion is parameterized and atomically rechecks membership, signer, executor, active session",async()=>{
 const x=mock([{challenge_id:CHALLENGE}]);
 await x.ports.challenges.store(challenge);
 assert.match(x.calls[0].sql,/INSERT INTO katosync_private.approval_challenges/);
 assert.match(x.calls[0].sql,/project_memberships/);
 assert.match(x.calls[0].sql,/owner_user_id/);
 assert.match(x.calls[0].sql,/auth.sessions/);
 assert.deepEqual(x.calls[0].params.slice(0,3),[CHALLENGE,"a".repeat(43),ACCOUNT]);
 assert.equal(x.calls[0].params.at(-1),new Date(EXPIRES).toISOString());
 assert.equal(x.calls[0].sql.includes(CHALLENGE),false);
});
test("challenge insert with revoked account or offline DB fails closed",async()=>{
 for(const rows of [[],[{challenge_id:TARGET}]]){
  await assert.rejects(mock(rows).ports.challenges.store(challenge));
 }
 const down={async query(){throw new Error("DB unavailable")}};
 await assert.rejects(createDurableAuthorizationPorts(down).challenges.store(challenge));
});
test("challenge consumed using atomic DB function, scoped to actor/session",async()=>{
 const row={
  challenge_id:CHALLENGE,nonce:challenge.nonce,account_id:ACCOUNT,
  project_id:"project-a",task_id:TASK,executor_device_id:TARGET,
  approver_device_id:DEVICE,expected_head:challenge.expectedHead,
  scope:"edit_worktree",user_id:OWNER,session_id:SESSION,
  expires_at:new Date(EXPIRES).toISOString(),
 };
 const x=mock([row]);
 assert.deepEqual(await x.ports.challenges.consume(CHALLENGE,OWNER,SESSION),challenge);
 assert.match(x.calls[0].sql,/consume_approval_challenge/);
 assert.deepEqual(x.calls[0].params,[CHALLENGE,OWNER,SESSION]);
 assert.equal(await mock([]).ports.challenges.consume(CHALLENGE,OWNER,SESSION),null);
 assert.equal(await mock([{...row,session_id:TARGET}]).ports.challenges.consume(CHALLENGE,OWNER,SESSION),null);
 assert.equal(await mock([{...row,scope:"git_push"}]).ports.challenges.consume(CHALLENGE,OWNER,SESSION),null);
});
