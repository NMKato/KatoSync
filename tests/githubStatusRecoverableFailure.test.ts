// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyGithubAuthFailure} from "../src/lib/githubAuthError.ts";
const read=(f:string)=>readFileSync(new URL(f,import.meta.url),"utf8");
test("native errors are reduced to secret-free, actionable reason categories",()=>{
 assert.equal(classifyGithubAuthFailure("Schlüsselbund kann nicht gelesen werden."),"keychain");
 assert.equal(classifyGithubAuthFailure("Bitte zuerst bei KatoSync anmelden."),"session");
 assert.equal(classifyGithubAuthFailure("KatoSync-Sitzung nicht überprüfbar."),"session");
 assert.equal(classifyGithubAuthFailure("GitHub konnte nicht erreicht werden."),"network");
 assert.equal(classifyGithubAuthFailure("GitHub App nicht eingerichtet."),"configuration");
 assert.equal(classifyGithubAuthFailure("Bearer SECRET-DO-NOT-DISPLAY"),"unknown");
 assert.equal(classifyGithubAuthFailure({foo:"bar"}),"unknown");
});
test("GitHub status failure remains retryable and preserves separate user consent",()=>{
 const app=read("../src/components/GithubAppConnectionPanel.tsx");
 assert.match(app,/function refreshStatus\(\)/);
 assert.match(app,/onClick=\{refreshStatus\}/);
 assert.match(app,/invoke<Status>\("github_app_connection_status"\)/);
 assert.match(app,/setError\(classifyGithubAuthFailure\(e\)\)/);
 assert.ok(!app.includes('setError(true)'),"generic error loses failure reason");
 assert.match(app,/github_app_device_begin/);
 assert.match(app,/github_app_disconnect/);
 for(const lang of ["de","en","es","ru"]){
  const locale=read("../src/i18n/locales/"+lang+".ts");
  for(const key of ["authRetryStatus","authDiagnosisSession","authDiagnosisKeychain","authDiagnosisNetwork","authDiagnosisConfiguration","authDiagnosisUnknown"])
   assert.ok(locale.includes('"kickoff.'+key+'":'),lang+" missing "+key);
 }
});
