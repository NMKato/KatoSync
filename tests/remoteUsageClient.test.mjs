import test from "node:test";
import assert from "node:assert/strict";
import {createRemoteUsageSessionClient} from "../src/lib/remoteUsageClient.ts";

const token = "synthetic.test-token.opaque-12345678901234567890";
const resourceUrl = "https://remote.example/mcp";
const summary = {
  version:1,live:true,timezone:"UTC",month:"2026-11",plan:"free",
  toolCalls:5,dailyAverage:1,monthlyLimit:10000,remaining:9995,
  usagePercent:0,quotaDenied:0,byDay:[],
  byClient:[],byDevice:[],byTool:[]
};
const history = {
  version:1,live:true,timezone:"UTC",
  months:Array.from({length:6},(_,i)=>({
    month:"2026-"+String(i+6).padStart(2,"0"),
    toolCalls:i===5?5:0,quotaDenied:0
  }))
};
const ok = value => Response.json(value);
const session = (sessionKey="synthetic-login-001",getAccessToken=async()=>token) =>
  ({sessionKey,getAccessToken});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test("RC12 is disconnected by default and never makes a spontaneous request",async()=>{
  let hits=0;
  const client=createRemoteUsageSessionClient({resourceUrl,transport:async()=>{hits++;throw Error("unexpected");}});
  assert.deepEqual(client.snapshot(),{status:"disconnected",summary:null,history:null});
  assert.equal((await client.refresh()).status,"disconnected");
  client.attach(session());
  assert.deepEqual(client.snapshot(),{status:"unavailable",summary:null,history:null});
  assert.equal(hits,0);
});

test("only two fixed owner-only GET endpoints are requested, with ephemeral token",async()=>{
  const requests=[];
  const client=createRemoteUsageSessionClient({resourceUrl,transport:async(url,options)=>{
    requests.push({url,options});
    return String(url).endsWith("/summary")?ok(summary):ok(history);
  }});
  const status=[];
  client.subscribe(x=>status.push(x.status));
  client.attach(session());
  const data=await client.refresh();
  assert.equal(data.status,"ready");
  assert.equal(data.summary.toolCalls,5);
  assert.equal(data.history.months.length,6);
  assert.deepEqual(requests.map(x=>x.url).sort(),[
    "https://remote.example/api/usage/history?months=6",
    "https://remote.example/api/usage/summary"
  ]);
  for(const r of requests){
    assert.equal(r.options.method,"GET");
    assert.equal(r.options.headers.Authorization,"Bearer "+token);
    assert.equal(r.options.credentials,"omit");
    assert.equal(r.options.cache,"no-store");
    assert.equal(r.options.redirect,"error");
    assert.equal(r.options.referrerPolicy,"no-referrer");
  }
  assert.deepEqual(status,["disconnected","unavailable","loading","ready"]);
});

test("unavailable token fails closed before any network request",async()=>{
  let hits=0;
  const client=createRemoteUsageSessionClient({resourceUrl,transport:async()=>{hits++;return ok(summary);}});
  client.attach(session("synthetic-login-002",async()=>null));
  assert.equal((await client.refresh()).status,"unauthorized");
  assert.equal(hits,0);
  assert.equal(client.snapshot().summary,null);
});

test("401 or 403 from either endpoint never yields partial or previously cached usage",async()=>{
  let deny=false;
  const client=createRemoteUsageSessionClient({resourceUrl,transport:async url=>
    deny&&String(url).includes("history")?Response.json({error:"DENIED"},{status:403}):
    String(url).includes("history")?ok(history):ok(summary)});
  client.attach(session());
  assert.equal((await client.refresh()).status,"ready");
  deny=true;
  const data=await client.refresh();
  assert.deepEqual(data,{status:"unauthorized",summary:null,history:null});
});

test("invalid JSON shape and non-JSON content never masquerade as real live usage",async()=>{
  for(const transport of [
    async url=>String(url).includes("history")?ok({...history,live:false}):ok(summary),
    async url=>String(url).includes("history")?ok({...history,months:[]}):ok(summary),
    async()=>new Response("<html>not-usage</html>",{headers:{"Content-Type":"text/html"}}),
    async()=>new Response("x".repeat(129*1024),{headers:{"Content-Type":"application/json"}})
  ]){
    const client=createRemoteUsageSessionClient({resourceUrl,transport});
    client.attach(session());
    const data=await client.refresh();
    assert.deepEqual(data,{status:"unavailable",summary:null,history:null});
  }
});

test("logout aborts pending requests and discards late responses",async()=>{
  const resolvers=[];
  const client=createRemoteUsageSessionClient({resourceUrl,transport:()=>new Promise(resolve=>{
    resolvers.push(resolve);
  })});
  client.attach(session());
  const outstanding=client.refresh();
  for(let i=0;i<10&&resolvers.length<2;i++)await tick();
  assert.equal(resolvers.length,2);
  client.disconnect();
  resolvers[0](ok(summary));resolvers[1](ok(history));
  await outstanding;
  assert.deepEqual(client.snapshot(),{status:"disconnected",summary:null,history:null});
});

test("switching login sessions discards stale in-flight responses",async()=>{
  const resolvers=[];
  const client=createRemoteUsageSessionClient({resourceUrl,transport:()=>new Promise(resolve=>{
    resolvers.push(resolve);
  })});
  client.attach(session("login-owner-001"));
  const oldRequest=client.refresh();
  for(let i=0;i<10&&resolvers.length<2;i++)await tick();
  assert.equal(resolvers.length,2);
  client.attach(session("login-owner-002"));
  resolvers[0](ok(summary));resolvers[1](ok(history));
  await oldRequest;
  assert.deepEqual(client.snapshot(),{status:"unavailable",summary:null,history:null});
});

test("session validation and endpoint security reject unsafe resources",()=>{
  for(const bad of [
    "http://remote.example/mcp","https://remote.example/api",
    "https://remote.example/mcp?token=abc",
    "https://user:pass@remote.example/mcp",
    "javascript:alert(1)"
  ])assert.throws(()=>createRemoteUsageSessionClient({resourceUrl:bad}),/INVALID_REMOTE_MCP_RESOURCE/);
  const client=createRemoteUsageSessionClient({resourceUrl,transport:async()=>ok(summary)});
  assert.throws(()=>client.attach(session("short")),/INVALID_REMOTE_USAGE_SESSION/);
});

test("listeners do not change security outcome and are unsubscribable",()=>{
  const client=createRemoteUsageSessionClient({resourceUrl,transport:async()=>ok(summary)});
  let observed=0;
  const remove=client.subscribe(()=>{observed++;throw new Error("UI broke");});
  client.attach(session());
  assert.equal(observed,2);
  remove();
  client.disconnect();
  assert.equal(observed,2);
});
