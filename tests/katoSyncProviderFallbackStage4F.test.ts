import {test} from "node:test";
import assert from "node:assert/strict";
import {planAgentProviderFallback} from "../src/lib/katoSyncProviderFallback.ts";
const base={
 approved:true,taskCanRunLocally:true,
 preference:["codex","claude"] as const,
 codex:{ready:true,quotaAvailable:true,concurrencyAvailable:true},
 claude:{ready:true,quotaAvailable:true,concurrencyAvailable:true},
 gemma:{modelLoaded:true,enoughFreeMemory:true,supportsTask:true,concurrencyAvailable:true}
};
test("connected paid Codex preferred, local backup not consuming paid provider",()=>{
 assert.deepEqual(planAgentProviderFallback(base),{mode:"run",provider:"codex",slowerLocalFallback:false});
});
test("when Codex and Claude are exhausted, local Gemma takes over",()=>{
 assert.deepEqual(planAgentProviderFallback({...base,codex:{...base.codex,quotaAvailable:false},claude:{...base.claude,quotaAvailable:false}}),
  {mode:"run",provider:"local_gemma",slowerLocalFallback:true});
});
test("if local hardware unsuitable or model cannot handle task, pause safely",()=>{
 for(const gemma of [{...base.gemma,enoughFreeMemory:false},{...base.gemma,modelLoaded:false},
                     {...base.gemma,supportsTask:false},{...base.gemma,concurrencyAvailable:false}]) {
  const answer=planAgentProviderFallback({...base,codex:{...base.codex,quotaAvailable:false},
   claude:{...base.claude,quotaAvailable:false},gemma});
  assert.deepEqual(answer,{mode:"queue",reason:"no_compatible_capacity"});
 }
});
test("no approval means no execution, even for free local model",()=>{
 assert.deepEqual(planAgentProviderFallback({...base,approved:false}),
  {mode:"queue",reason:"approval_required"});
});
test("quota exhausted but Claude available -> Claude before Gemma",()=>{
 assert.deepEqual(planAgentProviderFallback({...base,codex:{...base.codex,quotaAvailable:false}}),
  {mode:"run",provider:"claude",slowerLocalFallback:false});
});
