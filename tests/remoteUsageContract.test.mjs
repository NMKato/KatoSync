import test from "node:test";
import assert from "node:assert/strict";
import {parseUsageOverview,parseUsageHistory} from "../src/lib/remoteUsage.ts";

const valid={
  version:1,live:true,timezone:"UTC",month:"2026-11",plan:"free",
  toolCalls:1234,dailyAverage:154,monthlyLimit:10000,
  remaining:8766,usagePercent:12,quotaDenied:0,
  byDay:[{day:"2026-11-08",calls:154}],
  byClient:[{clientId:"chatgpt-client-01",calls:1234}],
  byDevice:[{deviceId:"11111111-1111-4111-8111-111111111111",calls:1234}],
  byTool:[{tool:"git.status",calls:1234}]
};
const months=Array.from({length:6},(_,i)=>({
  month:"2026-"+String(i+6).padStart(2,"0"),
  toolCalls:i*10,quotaDenied:0
}));
test("verified server Free stats provide 10k quota and no screenshot assumptions",()=>{
  const parsed=parseUsageOverview(valid);
  assert.equal(parsed?.toolCalls,1234);
  assert.equal(parsed?.remaining,8766);
  assert.equal(parsed?.live,true);
});
test("Pro may display no fixed tool-call cap only with matching live server contract",()=>{
  const pro={...valid,plan:"pro",monthlyLimit:null,remaining:null,usagePercent:null};
  assert.equal(parseUsageOverview(pro)?.plan,"pro");
  assert.equal(parseUsageOverview({...pro,remaining:10000}),null);
  assert.equal(parseUsageOverview({...valid,plan:"pro"}),null);
});
test("screenshots, demo figures and disconnected data never masquerade as live usage",()=>{
  assert.equal(parseUsageOverview(null),null);
  assert.equal(parseUsageOverview({...valid,live:false,toolCalls:32139}),null);
  assert.equal(parseUsageOverview({...valid,version:0}),null);
  assert.equal(parseUsageOverview({...valid,month:"not a month"}),null);
});
test("Free usage must have internally consistent limits",()=>{
  for(const v of [
    {...valid,remaining:9999},
    {...valid,monthlyLimit:1000000},
    {...valid,usagePercent:101},
    {...valid,toolCalls:-1},
    {...valid,toolCalls:Infinity}
  ]) assert.equal(parseUsageOverview(v),null);
});
test("usage breakdowns must be bounded and typed",()=>{
  for(const v of [
    {...valid,byTool:[{tool:"x",calls:-1}]},
    {...valid,byDay:"invalid"},
    {...valid,byClient:Array(11).fill({clientId:"client",calls:1})},
    {...valid,byDevice:[{deviceId:123,calls:1}]}
  ]) assert.equal(parseUsageOverview(v),null);
});
test("history has six ordered verified UTC months, not arbitrary annotations",()=>{
  assert.equal(parseUsageHistory({version:1,live:true,timezone:"UTC",months})?.months.length,6);
  assert.equal(parseUsageHistory({version:1,live:false,timezone:"UTC",months}),null);
  assert.equal(parseUsageHistory({version:1,live:true,timezone:"UTC",months:months.slice(1)}),null);
  assert.equal(parseUsageHistory({version:1,live:true,timezone:"UTC",months:[...months].reverse()}),null);
  assert.equal(parseUsageHistory({version:1,live:true,timezone:"Europe/Berlin",months}),null);
});
