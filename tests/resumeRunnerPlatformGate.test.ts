import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8")
 .replaceAll(String.fromCharCode(13),"");

test("macOS Terminal resume has safe non-macOS fallback",()=>{
 const macos=native.indexOf('#[cfg(target_os = "macos")]');
 const stub=native.indexOf('#[cfg(not(target_os = "macos"))]');
 assert.ok(macos>0&&stub>macos);
 assert.match(native.slice(macos,stub),/fn resume_runner_session/);
 assert.match(native.slice(stub),/fn resume_runner_session/);
 assert.match(native.slice(stub),/RESUME_UNSUPPORTED_PLATFORM/);
});
