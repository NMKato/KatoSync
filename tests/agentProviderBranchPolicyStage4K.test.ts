// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeAgentBranch, expectedAgentBranch, authorizeSharedProjectRead,
  type AgentBranchIdentity, type BranchEvidence
} from "../src/lib/agentProviderBranchPolicy.ts";
const id: AgentBranchIdentity={projectId:"katosync",source:"local",providerId:"gemma4",agentId:"rex",jobId:"job-20261110-0001"};
const make = (changes: Partial<BranchEvidence>={}): BranchEvidence => ({
  actualBranch:expectedAgentBranch(id),actualProjectId:"katosync",actualSource:"local",
  observedHead:"a".repeat(40),expectedHead:"a".repeat(40),
  gitAndOwnerVerified:true,activeWriterLease:false,approvedJob:true,
  signedHandoff:true,...changes
});
test("each provider and agent gets an isolated task branch, never main",()=>{
  const branch=expectedAgentBranch(id);
  assert.equal(branch,"agents/katosync/local/gemma4/rex/job-20261110-0001");
  for(const source of ["codex","claude","openai_api","anthropic_api","remote_orchestrator"] as const)
    assert.notEqual(expectedAgentBranch({...id,source}),branch);
  assert.notEqual(expectedAgentBranch({...id,jobId:"job-20261110-0002"}),branch);
  assert.notEqual(expectedAgentBranch({...id,providerId:"qwen3"}),branch);
});
test("invalid identifiers cannot escape the branch namespace",()=>{
  for(const bad of ["../main","main/branch","work tree","@{", "a".repeat(70)])
    assert.equal(expectedAgentBranch({...id,projectId:bad}),null);
  assert.equal(expectedAgentBranch({...id,source:"unknown" as never}),null);
});
test("branch policy is advisory even when evidence matches",()=>{
  const result=authorizeAgentBranch(id,make());
  assert.equal(result.reason,"safe");
  assert.equal(result.eligible,true);
  assert.equal(result.createsBranch,false);
  assert.equal(result.grantsWriterLease,false);
  assert.equal(result.automaticMerge,false);
});
test("different project, provider, branch and Git HEAD fail closed",()=>{
  assert.equal(authorizeAgentBranch(id,make({actualProjectId:"genxline"})).reason,"cross_project");
  assert.equal(authorizeAgentBranch(id,make({actualSource:"codex"})).reason,"foreign_provider");
  assert.equal(authorizeAgentBranch(id,make({actualBranch:"main"})).reason,"unverified_branch");
  assert.equal(authorizeAgentBranch(id,make({gitAndOwnerVerified:false})).eligible,false);
  assert.equal(authorizeAgentBranch(id,make({observedHead:"b".repeat(40)})).reason,"stale_head");
});
test("single-writer lease, owner gate and signed handoff are required",()=>{
  assert.equal(authorizeAgentBranch(id,make({activeWriterLease:true})).reason,"writer_busy");
  assert.equal(authorizeAgentBranch(id,make({approvedJob:false})).reason,"missing_approval");
  assert.equal(authorizeAgentBranch(id,make({signedHandoff:false})).reason,"handoff_unverified");
});
test("canonical memory is project-scoped and never directly writable",()=>{
  const sample={
    projectId:"katosync",requestedBy:"codex" as const,permittedProjects:["katosync"],
    canonicalSnapshotVerified:true,canonicalRevision:"c".repeat(40)
  };
  const ok=authorizeSharedProjectRead(sample);
  assert.equal(ok.allowed,true);
  assert.equal(ok.readOnly,true);
  assert.equal(ok.mayPromoteMemory,false);
  assert.equal(ok.mayWriteProjectStatusFlow,false);
  assert.equal(ok.crossProjectContentsExposed,false);
  assert.equal(authorizeSharedProjectRead({...sample,projectId:"genxline"}).allowed,false);
  assert.equal(authorizeSharedProjectRead({...sample,canonicalSnapshotVerified:false}).allowed,false);
});
