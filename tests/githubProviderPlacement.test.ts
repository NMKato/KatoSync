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


test("KatoSync login copy must not claim cross-project KATOOS SSO before federation",()=>{
  const fs = requireLocaleFiles();
  const texts = Object.values(fs);
  for(const locale of texts) {
    assert.doesNotMatch(locale,/"login\.hint":\s*"[^"]*SSO (mit|with|con|с)/i);
    assert.match(locale,/"login\.subtitle":\s*"[^"]*KatoSync/);
    assert.match(locale,/"github\.integration\.existingSession":\s*"[^"]*KatoSync/);
  }
});
function requireLocaleFiles(){
  return Object.fromEntries(["de","en","es","ru"].map(lang=>[
    lang,readFileSync(new URL("../src/i18n/locales/"+lang+".ts",import.meta.url),"utf8")
  ]));
}
test("Local boot status requires a credential, not an old email file alone",()=>{
  const source=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
  const start=source.indexOf("fn supabase_session_status()");
  const end=source.indexOf("#[tauri::command]",start+1);
  const functionText=source.slice(start,end);
  assert.match(functionText,/load_supabase_refresh_token\(\)/);
  assert.match(functionText,/locally_resumable_session\(email\.as_deref\(\), refresh\.as_deref\(\)\)/);
  assert.doesNotMatch(functionText,/logged_in:\s*email\.is_some\(\)/);
  assert.match(source,/fn locally_resumable_session\(/);
});
