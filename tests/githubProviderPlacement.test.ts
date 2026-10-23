// Created by NMKato Solutions
// Native OAuth UI placement contract: normal KatoSync session, no second login.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
const provider=readFileSync(new URL("../src/components/GithubAppConnectionPanel.tsx",import.meta.url),"utf8");
test("GitHub is integrated in the authenticated provider area, not the login gate",()=>{
 const providerStart=app.indexOf('visibleStep === "agentProviders"');
 const providerEnd=app.indexOf('visibleStep === "agentMonitor"',providerStart);
 assert.ok(providerStart>0 && providerEnd>providerStart);
 const section=app.slice(providerStart,providerEnd);
 assert.match(section,/ProviderManager vm=\{vm\}/);
 assert.match(section,/vm\.sessionStatus\.loggedIn\s*\?\s*<section/);
 assert.match(section,/<GithubAppConnectionPanel/);
 const loginGuard=app.indexOf("if (!vm.sessionStatus.loggedIn)");
 assert.ok(loginGuard>0&&loginGuard<providerStart,
   "GitHub provider control must remain behind the app-wide login gate");
 assert.doesNotMatch(section,/login_supabase|signup_supabase|type="password"/);
});
test("OAuth uses GitHub consent, does not ask for a second KatoSync password",()=>{
 assert.match(provider,/github_app_device_begin/);
 assert.match(provider,/github_app_connection_status/);
 assert.match(provider,/github_app_disconnect/);
 assert.match(provider,/https:\/\/github\.com\/login\/device/);
 assert.doesNotMatch(provider,/login_supabase|signup_supabase|supabase_password_login|type="password"/);
});
