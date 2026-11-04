import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {shouldAutoResumeAgentWorkspace} from "../src/lib/workspaceMode.ts";

const ready={
  stage35FeatureEnabled:true,authenticated:true,licenseAccepted:true,
  splashComplete:true,savedMode:"agentSync" as const
};

test("Stage35 resumes previously chosen Agent Sync after verified launch",()=>{
  assert.equal(shouldAutoResumeAgentWorkspace(ready),true);
});
test("all authorization, license and prior choice gates fail closed",()=>{
  for(const key of ["stage35FeatureEnabled","authenticated","licenseAccepted","splashComplete"] as const){
    assert.equal(shouldAutoResumeAgentWorkspace({...ready,[key]:false}),false,key);
  }
  assert.equal(shouldAutoResumeAgentWorkspace({...ready,savedMode:null}),false);
  assert.equal(shouldAutoResumeAgentWorkspace({...ready,savedMode:"mistral"}),false);
});
test("auto-resume is a single startup attempt and cannot grant Mesh permissions",()=>{
  const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
  const begin=app.indexOf("// Stage35: one-time, no-side-effect workspace restoration");
  const end=app.indexOf("// Onboarding-Pflicht:",begin);
  assert.ok(begin>=0&&end>begin);
  const fragment=app.slice(begin,end);
  assert.match(fragment,/autoResumeAttempted\.current/);
  assert.match(fragment,/vm\.sessionStatus\.loggedIn/);
  assert.match(fragment,/VITE_STAGE35_AUTO_RESUME_QA/);
  assert.match(fragment,/setWorkspaceMode\("agentSync"\)/);
  assert.doesNotMatch(fragment,/mesh_account_device_discover|mesh_local_approve_peer|mesh_pairing_relay_send|run_codex_task/);
});
test("only the isolated Stage35 QA build sets the auto-resume flag",()=>{
  const script=readFileSync(new URL("../scripts/build-mesh-qa-stage35-macos.sh",import.meta.url),"utf8");
  assert.match(script,/VITE_STAGE35_AUTO_RESUME_QA=1 npm run build/);
  assert.match(script,/VITE_STAGE35_AUTO_RESUME_QA=1 npm exec/);
  const standard=readFileSync(new URL("../scripts/build-mesh-qa-stage3x-macos.sh",import.meta.url),"utf8");
  assert.doesNotMatch(standard,/VITE_STAGE35_AUTO_RESUME_QA/);
});
