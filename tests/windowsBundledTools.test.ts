import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("bundled Windows Poppler and Typst are .exe, never macOS Resources assumptions",()=>{
 assert.match(rust,/#\[cfg\(target_os = "windows"\)\]\nfn windows_bundled_tool/);
 assert.match(rust,/windows_bundled_tool\("poppler", "pdftotext\.exe"\)/);
 assert.match(rust,/windows_bundled_tool\("typst", "typst\.exe"\)/);
 assert.match(rust,/let install_dir = executable\.parent\(\)\?/);
 assert.match(rust,/\["resources", "resources\/resources", "\."\]/);
});
