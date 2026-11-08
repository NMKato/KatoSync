// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(filename:string)=>readFileSync(new URL(filename,import.meta.url),"utf8");
const panel=read("../src/components/GithubAppConnectionPanel.tsx");
const native=read("../src-tauri/src/github_app_auth.rs");
test("browser device approval automatically triggers native polling and status verification",()=>{
 assert.match(panel,/const sessionId=device\.sessionId/);
 assert.match(panel,/invoke<Poll>\("github_app_device_poll",\{sessionId\}\)/);
 assert.match(panel,/reply\.state==="connected"/);
 assert.match(panel,/invoke<Status>\("github_app_connection_status"\)/);
 assert.match(panel,/if\(!confirmed\.connected\)throw/);
 assert.ok(panel.indexOf('setStatus(confirmed);setError(null);setResult(t("kickoff.authConnected"))')<
   panel.indexOf('setDevice(null);',panel.indexOf('reply.state==="connected"')),
   "do not cancel React effect before asynchronous status result is consumed");
 assert.match(native,/storage\.set_password\(&payload\)/);
});
test("polling follows server intervals and cancels on navigation or device replacement",()=>{
 assert.match(panel,/Math\.min\(120,Math\.max\(5,Math\.ceil\(seconds\)\)\)/);
 assert.match(panel,/plan\(reply\.retryAfterSeconds\)/);
 assert.match(panel,/if\(Date\.now\(\)>=expiresAt\)/);
 assert.match(panel,/cancelled=true/);
 assert.match(panel,/clearTimeout\(timer\)/);
 assert.match(native,/session\.polling = true/);
 assert.match(native,/session\.polling = false/);
});
test("GitHub authorization remains explicit, with no privilege escalation",()=>{
 assert.match(panel,/function start\(\)/);
 assert.match(panel,/github_app_device_begin/);
 assert.match(panel,/authAutoCheck/);
 assert.match(panel,/github_app_device_cancel/);
 assert.match(native,/write_access_granted: false/);
 for(const lang of ["de","en","es","ru"]){
  assert.ok(read("../src/i18n/locales/"+lang+".ts").includes('"kickoff.authAutoCheck":'));
 }
});

test("native expiration refresh rotates securely and expired/revoked grants remain re-authorizable",()=>{
 assert.match(native,/async fn ensure_fresh_github_credentials\(uid: &str\)/);
 assert.match(native,/\.form\(&\[\s*\("client_id", id\),\s*\("grant_type", "refresh_token"\)/);
 assert.match(native,/REFRESH_MUTEX/);
 assert.match(native,/valid_rotated_token/);
 assert.match(native,/returned\.id != record\.user_id/);
 assert.match(native,/current\.refresh_token != record\.refresh_token/);
 assert.match(native,/secret_json\.zeroize\(\)/);
 assert.match(native,/"bad_refresh_token"/);
 assert.match(native,/return Ok\(Some\(record\)\)/);
 assert.ok(!native.includes('"client_secret",'),"Device Flow refresh must not embed a client secret");
});
