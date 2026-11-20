// Created by NMKato Solutions – UX4 canonical issuer and private QA namespace contract.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const cargo = source("src-tauri/Cargo.toml");
const native = source("src-tauri/src/lib.rs");
const github = source("src-tauri/src/github_app_auth.rs");
const app = source("src/App.tsx");
const config = JSON.parse(source("src-tauri/tauri.ux4-katoos-auth-qa.conf.json"));
const builder = source("scripts/build-ux4-katoos-auth-qa-macos.sh");

test("UX4 uses the canonical KATOOS issuer, never the legacy KatoSync auth project", () => {
  assert.match(cargo, /ux4-auth-qa = \["katoos-auth-qa"\]/);
  assert.match(native, /#\[cfg\(feature = "katoos-auth-qa"\)\]\s*const KATOSYNC_AUTH_URL/);
  assert.match(native, /#\[cfg\(not\(feature = "katoos-auth-qa"\)\)\]\s*const KATOSYNC_AUTH_URL/);
  assert.match(app, /VITE_KATOOS_AUTH_QA/);
});

test("UX4 has a distinct Keychain service for tokens and GitHub App", () => {
  assert.match(native, /#\[cfg\(feature = "ux4-auth-qa"\)\]\s*const KEYCHAIN_SERVICE: &str = "com\.nmkato\.katosync\.katoos\.ux4\.qa"/);
  assert.match(github, /#\[cfg\(feature = "ux4-auth-qa"\)\]\s*const KEYCHAIN_SERVICE: &str = "com\.nmkato\.katosync\.katoos\.ux4\.qa"/);
  assert.doesNotMatch(native, /#\[cfg\(feature = "ux4-auth-qa"\)\]\s*const KEYCHAIN_SERVICE: &str = "com\.nmkato\.katosync\.katoos\.stage4j\.qa"/);
});
test("UX4 stores private settings and logs in distinct directories", () => {
  assert.equal((native.match(/\.join\(if cfg!\(feature = "ux4-auth-qa"\)/g) ?? []).length, 2);
  assert.equal((native.match(/"KatoSync UX4 KATOOS Auth QA"/g) ?? []).length, 2);
  assert.match(native, /com\.nmkato\.katosync\.ux4\.qa\.sync/);
});
test("QA bundle is distinct from both previously running apps", () => {
  assert.equal(config.identifier, "com.nmkato.katosync.ux4katoosqa20261120");
  assert.notEqual(config.identifier, "com.nmkato.katosync.meshqa.stage4j-isolated");
  assert.notEqual(config.identifier, "com.nmkato.katosync.ux4qa20261120");
  assert.equal(config.build.beforeBuildCommand, "");
  assert.equal(config.bundle.macOS.signingIdentity, null);
});
test("No signup/extra grant in the canonical QA login UI", () => {
  assert.match(app, /VITE_KATOOS_AUTH_QA\s*!==\s*"1"/);
  assert.match(native, /KATOOS-Test: neue Konten nur auf der offiziellen KATOOS-Seite/);
  assert.match(native, /KATOOS-Test: Cloud-Profil-Änderungen deaktiviert/);
});

test("Reproducible QA build always pairs canonical frontend and native feature", () => {
  assert.match(builder, /export VITE_KATOOS_AUTH_QA=1/);
  assert.match(builder, /--features ux4-auth-qa/);
  assert.match(builder, /--config src-tauri\/tauri\.ux4-katoos-auth-qa\.conf\.json/);
  assert.match(builder, /CARGO_PROFILE_RELEASE_STRIP=none/);
  assert.match(builder, /--no-sign --bundles app/);
  assert.match(builder, /CARGO_TARGET_DIR/);
});
