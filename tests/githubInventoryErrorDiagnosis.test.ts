// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyGithubInventoryFailure} from "../src/lib/githubInventoryFailure.ts";
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
test("bounded endpoint failures reveal no secrets",()=>{
 for(const kind of ["installations","repositories","issues"]){
  assert.equal(classifyGithubInventoryFailure("GH_INV_"+kind+"_HTTP_401"),"auth");
  assert.equal(classifyGithubInventoryFailure("GH_INV_"+kind+"_HTTP_403"),"permission");
  assert.equal(classifyGithubInventoryFailure("GH_INV_"+kind+"_HTTP_404"),"missing");
  assert.equal(classifyGithubInventoryFailure("GH_INV_"+kind+"_HTTP_429"),"rate");
 }
 assert.equal(classifyGithubInventoryFailure("Bearer SECRET"),"unknown");
 assert.equal(classifyGithubInventoryFailure({secret:"SECRET"}),"unknown");
});
test("GitHub Inventory renders localized diagnostic without raw error details",()=>{
 const view=read("../src/components/GithubAppReadOnlyInventory.tsx");
 const native=read("../src-tauri/src/github_app_inventory.rs");
 assert.match(view,/classifyGithubInventoryFailure\(e\)/);
 assert.match(native,/GH_INV_/);
 assert.match(native,/path\.starts_with\("\/user\/installations/);
 for(const lang of ["de","en","es","ru"]){
  const dict=read("../src/i18n/locales/"+lang+".ts");
  assert.ok(dict.includes('"github.inventory.reason.permission":'));
  assert.ok(dict.includes('"github.inventory.reason.unknown":'));
 }
});
