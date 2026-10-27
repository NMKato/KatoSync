// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const native=read("../src-tauri/src/lib.rs");
const ui=read("../src/components/VisionWorkspace.tsx");
const auth=read("../src-tauri/src/github_app_auth.rs");
const section=native.slice(native.indexOf("async fn renew_katoos_qa_session("),native.indexOf("async fn recover_supabase("));
test("QA-only reauth validates same account and preserves GitHub",()=>{
  for(const needle of ["katoos-auth-qa","read_supabase_session_email","eq_ignore_ascii_case","auth/v1/user","is_same_cached_katosync_user","save_supabase_refresh_token"])
    assert.ok(section.includes(needle),needle);
  assert.ok(section.indexOf("save_supabase_refresh_token")>section.indexOf("auth/v1/user"));
  for(const bad of ["purge_local_credentials","on_katosync_account_switch","logout_supabase","delete_credential"])
    assert.ok(!section.includes(bad),bad);
  assert.ok(auth.includes("is_same_cached_katosync_user"));
});
test("password stays in isolated app and is cleared after each attempt",()=>{
  assert.ok(native.includes("renew_katoos_qa_session,"));
  assert.ok(ui.includes('VITE_KATOOS_AUTH_QA==="1"'));
  assert.ok(ui.includes('type="password" autoComplete="current-password"'));
  const start=ui.indexOf("const renewSession=async");
  const stop=ui.indexOf("const [directory",start);
  const part=ui.slice(start,stop);
  assert.ok(part.includes('setReauthPassword("")'));
  for(const bad of ["console.","localStorage","mesh_local_approve_peer","remote_task_execute"])
    assert.ok(!part.includes(bad),bad);
});
test("QA session reauth available in four languages",()=>{
 for(const lang of ["de","en","es","ru"]){
  const v=read("../src/i18n/locales/"+lang+".ts");
  for(const key of ["title","description","email","password","submit","success","failed"])
    assert.ok(v.includes('"mesh.reauth.'+key+'":'));
 }
});
