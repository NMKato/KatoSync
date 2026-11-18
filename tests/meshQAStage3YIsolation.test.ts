import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const lib=read("src-tauri/src/lib.rs");
const auth=read("src-tauri/src/github_app_auth.rs");
test("Stage3X has a dedicated Keychain namespace, data and logs directory",()=>{
  assert.match(lib,/const KEYCHAIN_SERVICE: &str = "com\.nmkato\.katosync\.katoos\.stage3x\.qa"/);
  assert.match(auth,/const KEYCHAIN_SERVICE: &str = "com\.nmkato\.katosync\.katoos\.stage3x\.qa"/);
  assert.match(lib,/cfg!\(feature = "stage3x-qa"\)/);
  assert.match(lib,/KatoSync Mesh QA Stage3X/);
  assert.match(auth,/assert_eq!\(KEYCHAIN_SERVICE, crate::KEYCHAIN_SERVICE\)/);
});
test("Stage3X has a dedicated LaunchAgent and opt-in Rust feature",()=>{
  assert.match(lib,/const LAUNCH_AGENT_ID: &str = "com\.nmkato\.katosync\.meshqa\.stage3x\.sync"/);
  assert.match(read("src-tauri/Cargo.toml"),/stage3x-qa = \["katoos-auth-qa"\]/);
  assert.match(read("scripts/build-mesh-qa-stage3x-macos.sh"),/--features stage3x-qa/);
  assert.doesNotMatch(read("scripts/build-mesh-qa-stage3x-macos.sh"),/--features katoos-auth-qa/);
});
test("Stable and earlier QA Keychain namespaces remain separate",()=>{
  for(const value of ["com.nmkato.katosync","com.nmkato.katosync.github.login.qa",
    "com.nmkato.katosync.katoos.auth.qa"]){
    assert.ok(lib.includes(value),value);
  }
  assert.match(auth,/cfg!\(feature = "stage3x-qa"\)/);
});
test("Installer stages, verifies, then publishes signed app atomically",()=>{
 const builder=read("scripts/build-mesh-qa-stage3x-macos.sh");
 for(const pattern of [/STAGING="\$\(mktemp -d /, /APP="\$STAGING\/KatoSync Mesh QA Stage3X\.app"/,
   /ditto "\$BASE" "\$APP"/, /codesign --verify --deep --strict "\$APP"/,
   /\[\[ ! -e "\$OUT" \]\]/, /mv "\$APP" "\$OUT"/,
   /codesign --verify --deep --strict "\$OUT"/])assert.match(builder,pattern);
 assert.ok(builder.indexOf('codesign --verify --deep --strict "$APP"') <
  builder.indexOf('mv "$APP" "$OUT"'));
 assert.ok(builder.indexOf('mv "$APP" "$OUT"') <
  builder.indexOf('echo "STAGE3X_SIGNED_SEPARATE_APP_READY"'));
});
