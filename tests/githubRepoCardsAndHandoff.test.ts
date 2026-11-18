// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {githubIssueChatDraft,githubRepoOwner,githubRepoTitle} from "../src/lib/githubInventoryPresentation.ts";
const source=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");

test("GitHub display titles omit repeated owner and prettify repository slugs without mutating IDs",()=>{
 assert.equal(githubRepoTitle("NMKato/03-03-foodtracker-NMKato"),"03 Food Tracker");
 assert.equal(githubRepoTitle("NMKato/03-05-ProjektWoche1-Gruppe1"),"03 05 Projekt Woche 1 Gruppe 1");
 assert.equal(githubRepoTitle("NMKato/GENXLine"),"GENXLine");
 assert.equal(githubRepoTitle("NMKato/Chatbot"),"Chatbot");
 assert.equal(githubRepoTitle("NMKato/KAI_Desktop_Agent"),"KAI Desktop Agent");
 assert.equal(githubRepoOwner("NMKato/GENXLine"),"NMKato");
 assert.equal(githubRepoTitle("NMKato/"),"NMKato/");
});
test("GitHub issue handoff preview never requests execution or performs automatic writes",()=>{
 const draft=githubIssueChatDraft({
  fullName:"NMKato/GENXLine",number:571,title:"WORLD planning",
  url:"https://github.com/NMKato/GENXLine/issues/571",note:"Zuerst Tests prüfen"
 });
 assert.match(draft,/NMKato\/GENXLine/);
 assert.match(draft,/#571/);
 assert.match(draft,/Zuerst Tests prüfen/);
 assert.match(draft,/bis zur ausdrücklichen/);
 assert.match(draft,/externe Projektmetadaten/);
 assert.doesNotMatch(draft,/automatisch starten|Schreibzugriff erteilen/i);
});
test("GitHub inventory UI contains title grid, explicit note preview, bounded paging and no native write invocations",()=>{
 const ui=source("../src/components/GithubAppReadOnlyInventory.tsx");
 const css=source("../src/styles.css");
 const native=source("../src-tauri/src/github_app_inventory.rs");
 assert.match(ui,/githubRepoTitle\(repo.fullName\)/);
 assert.match(ui,/githubRepoOwner\(repo.fullName\)/);
 assert.match(css,/grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,220px\),1fr\)\);/);
 assert.match(ui,/onClick=\{\(\)=>\{setDraft\(/);
 assert.match(ui,/navigator\.clipboard\.writeText\(githubIssueChatDraft/);
 assert.match(ui,/disabled title=\{t\("github.inventory.noAutostart"\)\}/);
 assert.match(ui,/page:nextPage/);
 assert.match(native,/valid_issue_page\(page\)/);
 assert.match(native,/MAX_ISSUE_PAGES: u32 = 10/);
 assert.match(native,/&page=\{page\}/);
 assert.doesNotMatch(native,/\.post\(|\.patch\(|\.put\(|\.delete\(/);
 assert.doesNotMatch(ui,/run_codex_task|run_claude|execute_|auto_start|invoke<.*\("issue_create"/);
});
