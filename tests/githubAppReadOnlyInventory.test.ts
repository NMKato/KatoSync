// Created by NMKato Solutions
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
const source=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");

test("GitHub App inventory only uses read-only API endpoints and native keychain",()=>{
 const backend=source("../src-tauri/src/github_app_inventory.rs");
 const auth=source("../src-tauri/src/github_app_auth.rs");
 const lib=source("../src-tauri/src/lib.rs");
 assert.match(backend,/\/user\/installations\?per_page=100&page=1/);
 assert.match(backend,/\/user\/installations\/\{installation_id\}\/repositories/);
 assert.match(backend,/\/repos\/\{full_name\}\/issues\?state=open/);
 assert.match(backend,/same_account_and_credential\(&uid/);
 assert.match(backend,/valid_full_name\(&full_name\)/);
 assert.match(backend,/github_read/);
 assert.doesNotMatch(backend,/\.post\(|\.patch\(|\.put\(|\.delete\(/);
 assert.doesNotMatch(backend,/Command::new|std::process|gh auth|token:\s*String/);
 assert.match(backend,/remote_writes_performed: false/);
 assert.match(auth,/pub\(crate\) mod inventory;/);
 assert.match(lib,/inventory::github_app_repository_inventory/);
 assert.match(lib,/inventory::github_app_repo_issues/);
});

test("GitHub project and issue UI loads only on explicit operator action",()=>{
 const ui=source("../src/components/GithubAppReadOnlyInventory.tsx");
 const parent=source("../src/components/GithubAppConnectionPanel.tsx");
 assert.match(parent,/status\?\.connected\?<GithubAppReadOnlyInventory/);
 assert.match(ui,/onClick=\{\(\)=>void load\(\)\}/);
 assert.match(ui,/onClick=\{\(\)=>void showIssues\(repo\)\}/);
 assert.match(ui,/github_app_repository_inventory/);
 assert.match(ui,/github_app_repo_issues/);
 assert.match(ui,/remoteWritesPerformed!==false/);
 assert.match(ui,/authSource!=="github_app_user_access_token"/);
 assert.doesNotMatch(ui,/accessToken|refreshToken|type="password"/);
});
