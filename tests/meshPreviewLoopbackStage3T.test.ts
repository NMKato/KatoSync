// Stage 3T: static limits on the actual compiled native GoTrue QA path.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const auth=read("src-tauri/src/mesh_preview_auth.rs");
const native=read("src-tauri/src/mesh_preview_auth_tests_3t.rs");
test("isolated preview storage is per-project and rejects stale issuer",()=>{
 assert.match(auth,/format!\("\{ACCOUNT\}:\{\}", cfg\.project_ref\)/);
 assert.match(auth,/issuer_origin: String/);
 assert.match(auth,/stored\.issuer_origin != cfg\.origin/);
 assert.match(auth,/"issuer_origin":cfg\.origin/);
 assert.match(auth,/fn load_session\(cfg: &PreviewConfig\)/);
 assert.match(auth,/fn save_session\(cfg: &PreviewConfig/);
 assert.match(auth,/isolated_entry\(&cfg\)/);
 assert.doesNotMatch(auth,/crate::ensure_supabase_access_token/);
});
test("network responses enforce streamed byte caps and reject HTTP redirects",()=>{
 assert.match(auth,/fn bounded_auth_body|async fn bounded_auth_body/);
 assert.match(auth,/content_length\(\)/);
 assert.match(auth,/response\.chunk\(\)\.await/);
 assert.match(auth,/if chunk\.len\(\) > MAX_RESPONSE - out\.len\(\)/);
 assert.match(auth,/redirect\(reqwest::redirect::Policy::none\(\)\)/);
});
test("actual Rust GoTrue synthetic HTTP tests cover login refresh identity and deny states",()=>{
 for(const expected of [
  "rust_http_gotrue_password_grant_and_online_user_match_in_one_issuer",
  "rust_http_gotrue_refresh_grant_uses_same_preview_issuer",
  "anonymous_or_malformed_online_user_never_verified",
  "malformed_or_oversized_gotrue_reply_denied_before_auth",
  "gotrue_issuer_http_redirect_and_forbidden_fail_closed",
  "two_preview_projects_have_distinct_keychain_account_names"
 ]) assert.ok(native.includes(expected),expected);
 assert.match(native,/TcpListener::bind\("127\.0\.0\.1:0"\)/);
 assert.match(native,/test-only|synthetic/);
 assert.doesNotMatch(native,/https:\/\/xbnnlyyxiilklsygxcof\.supabase\.co/);
});
