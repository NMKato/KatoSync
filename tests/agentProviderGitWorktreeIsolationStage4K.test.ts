// Created by NMKato Solutions
// Real Git worktree isolation fixture; never touches a user repository or a remote.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {expectedAgentBranch} from "../src/lib/agentProviderBranchPolicy.ts";

function git(cwd:string,...args:string[]):string {
  const r=spawnSync("git",args,{cwd,encoding:"utf8",timeout:10_000});
  assert.equal(r.status,0,"Git fixture failed: "+args.join(" ")+"; "+r.stderr);
  return r.stdout.trim();
}
test("real isolated Git worktrees: local Gemma and Codex cannot modify each other's checkout or main",()=>{
  const dir=mkdtempSync(join(tmpdir(),"katosync-agent-worktree-proof-"));
  try {
    const repo=join(dir,"repo");
    mkdirSync(repo);
    git(repo,"init","-q","-b","main");
    git(repo,"config","user.name","KatoSync QA");
    git(repo,"config","user.email","qa@example.invalid");
    writeFileSync(join(repo,"feature.txt"),"BASE\n");
    git(repo,"add","feature.txt");
    git(repo,"commit","-qm","fixture base");
    const base=git(repo,"rev-parse","HEAD");
    const names=[
      expectedAgentBranch({projectId:"katosync",source:"local",providerId:"gemma4",agentId:"rex",jobId:"job-20261110-0001"}),
      expectedAgentBranch({projectId:"katosync",source:"codex",providerId:"codexcli",agentId:"code",jobId:"job-20261110-0001"})
    ];
    assert.ok(names[0]&&names[1]&&names[0]!==names[1]);
    const roots=[join(dir,"local-agent"),join(dir,"codex-agent")];
    for(let i=0;i<2;i++){
      git(repo,"worktree","add","-q","-b",names[i]!,roots[i],base);
      git(roots[i],"config","user.name","KatoSync QA");
      git(roots[i],"config","user.email","qa@example.invalid");
      writeFileSync(join(roots[i],"feature.txt"),i===0?"LOCAL-ONLY\n":"CODEX-ONLY\n");
      git(roots[i],"add","feature.txt");
      git(roots[i],"commit","-qm","isolated provider proof "+i);
    }
    assert.equal(git(repo,"rev-parse","HEAD"),base);
    assert.equal(readFileSync(join(repo,"feature.txt"),"utf8"),"BASE\n");
    assert.equal(readFileSync(join(roots[0],"feature.txt"),"utf8"),"LOCAL-ONLY\n");
    assert.equal(readFileSync(join(roots[1],"feature.txt"),"utf8"),"CODEX-ONLY\n");
    assert.notEqual(git(roots[0],"rev-parse","HEAD"),git(roots[1],"rev-parse","HEAD"));
    assert.notEqual(git(repo,"rev-parse",names[0]!),base);
    assert.notEqual(git(repo,"rev-parse",names[1]!),base);
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
