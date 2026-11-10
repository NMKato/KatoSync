// NMKato Solutions — Stage4J signed macOS QA process lifetime contracts
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const main=source("src-tauri/src/lib.rs");
const guard=source("src-tauri/src/app_instance.rs");
const local=source("src-tauri/src/local_control.rs");
const build=source("scripts/build-mesh-qa-stage4j-candidate-macos.sh");
const brain=source("src-tauri/src/local_brain.rs");

test("signed Stage4J GUI only is protected, not headless sync or Stage35",()=>{
  assert.match(main,/#\[cfg\(all\(target_os = "macos", feature = "stage4j-qa"\)\)\]\s*mod app_instance;/);
  assert.match(main,/if !app_instance::allow_gui_start\(\) \{/);
  assert.ok(main.indexOf('if !app_instance::allow_gui_start()') > main.indexOf('if env::args().any(|arg| arg == "--run-sync")'));
  assert.match(build,/--features stage4j-qa/);
  assert.match(build,/KATOSYNC_STAGE4J_QA_SLOT/);
  assert.match(build,/SINGLETON_20261110/);
  assert.match(build,/\.KatoSync-Mesh-Stage4J-SingletonQA/);
});

test("one owner-level lock; ambiguous or unsafe processes do not get killed",()=>{
  assert.match(guard,/file\.try_lock\(\)/);
  assert.match(guard,/INSTANCE_ALREADY_RUNNING/);
  assert.match(guard,/file_type\(\)\.is_dir\(\)/);
  assert.match(guard,/info\.uid\(\) != uid/);
  assert.match(guard,/TeamIdentifier=\{TEAM_ID\}/);
  assert.match(guard,/codesign/);
  assert.match(guard,/Print :CFBundleIdentifier/);
  assert.match(guard,/process_list\(&home, uid, std::process::id\(\)\)/);
  assert.match(guard,/args\(\["-0", &pid\.to_string\(\)\]\)/);
  assert.doesNotMatch(guard,/args\(\["-9"|args\(\["-TERM"/);
});

test("legacy handoff is explicit, non-overlapping, and refuses to interrupt queued work",()=>{
  assert.match(guard,/handoff_work_idle\(\)/);
  assert.match(guard,/confirm_handoff\(\)/);
  assert.match(guard,/ask_old_to_quit\(app\.pid, &app\.bundle_id\)/);
  assert.match(guard,/if app\.bundle_id == NEW_APP \{/);
  assert.match(guard,/AppleEvent by bundle ID could address the wrong installation/);
  assert.match(guard,/process_list\(&home, uid, std::process::id\(\)\)/);
  assert.match(guard,/return false;/);
  assert.match(local,/pub\(crate\) fn handoff_work_idle\(\) -> bool/);
  assert.match(local,/snapshot\.queued_jobs\.is_empty\(\)/);
  assert.match(local,/snapshot\.active_lanes\.is_empty\(\)/);
  assert.match(local,/!snapshot\.orchestration\.work_active\(/);
});

test("local model server remains explicitly started; never auto-load two models at GUI boot",()=>{
  assert.match(brain,/static CHILD: OnceLock<Mutex<Option<Child>>>/);
  assert.match(brain,/const PORT: &str = "17842"/);
  assert.doesNotMatch(guard,/start_local_brain|install_local_brain|model_download/);
  assert.doesNotMatch(main.slice(main.indexOf('pub fn run()'),main.indexOf('fn reopen_main_window')),/\.start_local_brain\(/);
});
