import test from "node:test";
import assert from "node:assert/strict";
import {parseRc66ConsentSnapshot,makeRc66ConsentIntent}
  from "../src/lib/remoteConsent.ts";

const now=Date.parse("2026-11-14T22:45:00Z");
const id="11111111-1111-4111-8111-111111111111";
const otherId="22222222-2222-4222-8222-222222222222";
const base={
  version:1,live:true,source:"katosync-remote-mcp-consent",
  ownerVerified:true,revision:"rev_9QoWOydy7Ae1",
  observedAt:"2026-11-14T22:44:45Z",
  client:{oauthClientId:"123e4567-e89b-42d3-a456-426614174007",
    displayName:"KatoSync ChatGPT Beta",status:"approved",
    allowedTools:["devices.list","device.status"],
    expiresAt:"2026-11-15T20:00:00Z"},
  devices:[{deviceId:id,displayName:"M3",status:"approved",
    expiresAt:"2026-11-15T10:00:00Z"},
    {deviceId:otherId,displayName:"M2",status:"pending",expiresAt:null}]
};
const parsed=x=>parseRc66ConsentSnapshot(x,now);
test("only fresh, owner-verified live server snapshot is accepted",()=>{
  assert.equal(parsed(base)?.devices.length,2);
  for(const s of [
    null,{...base,live:false},{...base,ownerVerified:false},
    {...base,source:"client-local-state"},{...base,revision:""},
    {...base,observedAt:"2026-11-14T22:43:00Z"},
    {...base,observedAt:"2026-11-14T22:45:08Z"},
    {...base,devices:Array(51).fill(base.devices[0])}
  ]) assert.equal(parsed(s),null);
});
test("duplicate, invalid, cross-client and expired approvals fail closed",()=>{
  const bad=[
    {...base,devices:[base.devices[0],base.devices[0]]},
    {...base,devices:[{...base.devices[0],deviceId:"/etc/shadow"}]},
    {...base,devices:[{...base.devices[0],expiresAt:"2026-11-14T20:00:00Z"}]},
    {...base,client:{...base.client,expiresAt:"2026-11-14T21:00:00Z"}},
    {...base,client:{...base.client,allowedTools:["terminal.start"]}},
    {...base,client:{...base.client,status:"pending"}},
    {...base,client:null},
    {...base,devices:[{...base.devices[0],displayName:"\u0000Injected"}]},
    {...base,privateToken:"DO_NOT_EXPOSE"},
    {...base,client:{...base.client,privateKey:"DO_NOT_EXPOSE"}},
    {...base,devices:[{...base.devices[0],privateIp:"192.0.2.8"}]}
  ];
  for(const s of bad) assert.equal(parsed(s),null);
});
test("missing server evidence cannot turn pending or revoked grants into approved ones",()=>{
  for(const status of ["pending","revoked"]){
    const changed={...base,client:{...base.client,status},
      devices:[{...base.devices[1]}]};
    const snapshot=parsed(changed);
    assert.ok(snapshot);
    assert.equal(makeRc66ConsentIntent(snapshot,"approve_device",otherId,now),null);
  }
});
test("two-step review only produces an intent, not a client or device grant",()=>{
  const snapshot=parsed(base);
  assert.ok(snapshot);
  const ask=makeRc66ConsentIntent(snapshot,"approve_device",otherId,now);
  assert.deepEqual(ask,{
    version:1,action:"approve_device",expectedRevision:base.revision,
    oauthClientId:base.client.oauthClientId,deviceId:otherId
  });
  assert.equal(Object.hasOwn(ask,"approved"),false);
  assert.equal(Object.hasOwn(ask,"ownerId"),false);
  assert.equal(Object.hasOwn(ask,"token"),false);
  assert.deepEqual(makeRc66ConsentIntent(snapshot,"revoke_device",id,now)?.action,"revoke_device");
  assert.equal(makeRc66ConsentIntent(snapshot,"approve_device",id,now),null);
  assert.equal(makeRc66ConsentIntent(snapshot,"revoke_device",otherId,now),null);
  assert.equal(makeRc66ConsentIntent(snapshot,"approve_device","../secret",now),null);
  assert.equal(makeRc66ConsentIntent(snapshot,"approve_client",null,now),null);
  assert.equal(makeRc66ConsentIntent(snapshot,"terminal.start",null,now),null);
  assert.equal(makeRc66ConsentIntent(snapshot,"revoke_client",null,now)?.action,"revoke_client");
});
test("client may be requested only while pending; approved may only revoke",()=>{
  const pending=parsed({...base,client:{...base.client,status:"pending"},devices:[]});
  assert.ok(pending);
  assert.equal(makeRc66ConsentIntent(pending,"approve_client",null,now)?.action,"approve_client");
  assert.equal(makeRc66ConsentIntent(pending,"revoke_client",null,now),null);
  const revoked=parsed({...base,client:{...base.client,status:"revoked"},devices:[]});
  assert.ok(revoked);
  assert.equal(makeRc66ConsentIntent(revoked,"approve_client",null,now),null);
});
test("stale snapshot cannot be used to submit consent",()=>{
  const valid=parsed(base);
  assert.ok(valid);
  assert.equal(makeRc66ConsentIntent(valid,"revoke_client",null,now+120000),null);
});
