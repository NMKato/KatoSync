// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import {decideLocalBrainResidency, LOCAL_BRAIN_OS_RESERVE_BYTES} from "../src/lib/localBrainResidencyPolicy.ts";
const G=1024**3;
const model={id:"kato-local-brain",runtimeVerified:true,weightsVerified:true,
  bytesWeights:4590807392,bytesVision:559874816,contextOverheadBytes:1.5*G,runtimeOverheadBytes:.8*G};
const host={totalUnifiedBytes:16*G,conservativeReclaimableBytes:12*G,sampleAgeMs:200,
  memoryPressure:"normal" as const,ownModelRunning:false,ownAliasVerified:false,ownInferenceBusy:false,
  foreignModelsDetected:1,appOpenOrMinimized:true};
test("reserve budget includes one unified GPU/CPU pool, plus OS headroom",()=>{
  assert.equal(LOCAL_BRAIN_OS_RESERVE_BYTES,2*G);
  const r=decideLocalBrainResidency(model,host);
  assert.equal(r.state,"warm_allowed");
  assert.equal(r.stopForeignModels,false);
  assert.equal(r.gpuBudgetSeparate,false);
});
test("16-GiB Mac with 35% free memory defers rather than killing KAI's 1B server",()=>{
  const r=decideLocalBrainResidency(model,{...host,conservativeReclaimableBytes:16*G*.35});
  assert.deepEqual([r.state,r.reason,r.stopForeignModels],["defer","insufficient_unified_memory",false]);
});
test("critical pressure, stale telemetry and unknown signals all defer",()=>{
  assert.equal(decideLocalBrainResidency(model,{...host,memoryPressure:"critical"}).reason,"memory_pressure");
  assert.equal(decideLocalBrainResidency(model,{...host,sampleAgeMs:20000}).reason,"unreliable_memory_telemetry");
  assert.equal(decideLocalBrainResidency(model,{...host,conservativeReclaimableBytes:NaN}).state,"defer");
});
test("only verified KatoSync model and runtime are eligible",()=>{
  assert.equal(decideLocalBrainResidency({...model,weightsVerified:false},host).reason,"missing_verified_package");
  assert.equal(decideLocalBrainResidency({...model,runtimeVerified:false},host).reason,"missing_verified_package");
});
test("minimized app retains its own warm brain; closed app does not auto-start",()=>{
  assert.equal(decideLocalBrainResidency(model,{...host,ownModelRunning:true,ownAliasVerified:true}).state,"resident");
  assert.equal(decideLocalBrainResidency(model,{...host,appOpenOrMinimized:false}).reason,"app_not_open");
});
test("external servers never become kill targets, even with memory pressure",()=>{
  for (const foreignModelsDetected of [0,1,3,12]) {
    const result=decideLocalBrainResidency(model,{...host,foreignModelsDetected,memoryPressure:"critical"});
    assert.equal(result.stopForeignModels,false);
    assert.equal(result.keepCoordinator,true);
  }
});


test("an unknown local process or wrong alias never counts as KatoSync resident",()=>{
  const r=decideLocalBrainResidency(model,{...host,ownModelRunning:true,ownAliasVerified:false});
  assert.equal(r.state,"defer");
  assert.equal(r.reason,"untrusted_local_process");
  assert.equal(r.stopForeignModels,false);
});
test("own model under critical pressure pauses new inference and waits for idle before release",()=>{
  const busy=decideLocalBrainResidency(model,{...host,ownModelRunning:true,ownAliasVerified:true,
     ownInferenceBusy:true,memoryPressure:"critical"});
  assert.equal(busy.state,"degraded");
  assert.equal(busy.pauseNewInference,true);
  assert.equal(busy.releaseOwnWhenIdle,false);
  const idle=decideLocalBrainResidency(model,{...host,ownModelRunning:true,ownAliasVerified:true,
     ownInferenceBusy:false,memoryPressure:"critical"});
  assert.equal(idle.releaseOwnWhenIdle,true);
  assert.equal(idle.stopForeignModels,false);
});
