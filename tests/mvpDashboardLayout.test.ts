// Created by NMKato Solutions
import assert from "node:assert/strict";
import {test} from "node:test";
import {partitionMvpDashboard,MVP_DASHBOARD_TOP_COUNT} from "../src/lib/mvpDashboardLayout.ts";
import type {RegistryProject} from "../src/types.ts";

type Project=Pick<RegistryProject,"id"|"name"|"focus">;
function make(id:string,name:string,status:"active"|"parked"|"archived",priority:"P0"|"P1"|"P2"):Project{
  return {id,name,focus:{status,priority,autoMode:"off",scope:null,origin:"user",updatedAt:"2026-10-22T09:00:00Z"}};
}

test("shows at most three prioritized projects and puts all others into overflow",()=>{
  const projects=[
    make("hidden","Inactive but P0","parked","P0"),
    make("p2","Later P2","active","P2"),
    make("a","Alpha P1","active","P1"),
    make("p0","Critical P0","active","P0"),
    make("b","Beta P1","active","P1"),
    make("archive","Archived P0","archived","P0")
  ];
  const original=projects.map(p=>p.id);
  const result=partitionMvpDashboard(projects);
  assert.equal(MVP_DASHBOARD_TOP_COUNT,3);
  assert.deepEqual(result.top.map(p=>p.id),["p0","a","b"]);
  assert.deepEqual(result.rest.map(p=>p.id),["p2","hidden","archive"]);
  assert.deepEqual(projects.map(p=>p.id),original,"never mutate source projects");
});
test("small portfolios never display placeholder overflow",()=>{
  assert.deepEqual(partitionMvpDashboard([]),{top:[],rest:[]});
  const justTwo=[make("x","X","active","P0"),make("y","Y","active","P1")];
  const group=partitionMvpDashboard(justTwo);
  assert.equal(group.top.length,2);
  assert.equal(group.rest.length,0);
});
test("stable project identity prevents duplicate cards and keeps same-priority alphabetical order",()=>{
  const projects=[
    make("b","Same","active","P0"),
    make("a","Same","active","P0"),
    make("a","Duplicate from stale registry","parked","P2"),
    make("c","Third","active","P1"),
    make("d","Fourth","active","P1")
  ];
  const {top,rest}=partitionMvpDashboard(projects);
  assert.deepEqual(top.map(x=>x.id),["a","b","d"]);
  assert.deepEqual(rest.map(x=>x.id),["c"]);
  assert.equal(new Set([...top,...rest].map(x=>x.id)).size,4);
});
