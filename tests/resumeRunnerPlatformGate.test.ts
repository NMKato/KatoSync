import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("macOS Terminal resume has safe non-macOS fallback",()=>{
 assert.match(native, /#\[cfg\(target_os = "macos"\)\]\n\/\/\/ Setzt einen Runner-Lauf/);
 assert.match(native, /#\[cfg\(not\(target_os = "macos"\)\)\]\n#\[tauri::command\]\nfn resume_runner_session/);
 assert.match(native, /RESUME_UNSUPPORTED_PLATFORM/);
});
