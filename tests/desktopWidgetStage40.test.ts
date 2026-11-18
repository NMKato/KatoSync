import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectDesktopWidget,safeWidgetTaskTitle,widgetSnapshotFresh} from "../src/lib/desktopWidgetState40.ts";
import type {AgentJob,AgentSyncState} from "../src/types.ts";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const job=(status:AgentJob["status"],task="KatoSync QA prüfen"):AgentJob=>
  ({id:"j",projectId:"katosync",source:"runner",status,task,phase:"",owner:"codex",handoffs:[]});
test("desktop widget reports actual running/queued/attention jobs, not imagined progress",()=>{
 const state={jobs:[job("running"),job("queued"),job("blocked"),job("failed")]} as AgentSyncState;
 assert.deepEqual(projectDesktopWidget(state,true,true),{
   signedIn:true,activeJobs:1,queuedJobs:1,needsAttention:2,
   taskTitle:"KatoSync QA prüfen",localModelRunning:true
 });
});
test("logout hides any prior job or local model details",()=>{
 const state={jobs:[job("running")]} as AgentSyncState;
 assert.deepEqual(projectDesktopWidget(state,false,true),{
   signedIn:false,activeJobs:0,queuedJobs:0,needsAttention:0,
   taskTitle:null,localModelRunning:false
 });
});
test("private paths, email and credentials never become task titles",()=>{
 for(const task of ["/Users/example/private","ABC token=abc","secret is xyz","name@example.com",
   "password","api_key", "a".repeat(91), "\r\n"]){
  assert.equal(safeWidgetTaskTitle(task),null,task);
 }
 assert.equal(safeWidgetTaskTitle("  Agenten-Tests   durchführen  "),"Agenten-Tests durchführen");
});
test("unresponsive or future status is stale, not online",()=>{
 const snapshot={...projectDesktopWidget({jobs:[]} as AgentSyncState,true,false),updatedAtMs:1000,stale:false};
 assert.equal(widgetSnapshotFresh(snapshot,89_000),true);
 assert.equal(widgetSnapshotFresh(snapshot,91_001),false);
 assert.equal(widgetSnapshotFresh({...snapshot,stale:true},20_000),false);
 assert.equal(widgetSnapshotFresh(snapshot,500),false);
 assert.equal(widgetSnapshotFresh(null,20_000),false);
});
test("widget is a different signed local window and cannot mutate trust from its own UI",()=>{
 const native=read("src-tauri/src/desktop_widget.rs");
 const shell=read("src/desktopWidget40.tsx");
 const lib=read("src-tauri/src/lib.rs");
 const capability=JSON.parse(read("src-tauri/capabilities/widget.json"));
 const vite=read("vite.config.ts");
 assert.deepEqual(capability.windows,["desktop-widget"]);
 assert.ok(native.includes('require_window(&window, "main")'));
 assert.ok(native.includes('require_window(&window, WIDGET_LABEL)'));
 assert.ok(native.includes('WebviewUrl::App("widget.html".into())'));
 assert.match(native,/matches!\(\s*destination\.as_str\(\),\s*"jobs" \| "chat" \| "dashboard" \| "agent"/);
 assert.ok(native.includes("start_dragging()"));
 assert.ok(lib.includes("desktop_widget::desktop_widget_open_main"));
 assert.ok(vite.includes('widget: resolve('));
 assert.ok(shell.includes("widgetSnapshotFresh"));
 assert.ok(shell.includes("showDetails"));
 for(const forbidden of ["mesh_local_approve_peer","mesh_pairing_relay_send","remote_task_execute","supabase-refresh-token"])
   assert.ok(!shell.includes(forbidden),forbidden);
});
test("setup remains explicitly clicked, auto-starts and only reports success when running",()=>{
 const vm=read("src/viewmodels/useKatoSyncViewModel.ts");
 const relevant=vm.slice(vm.indexOf("const handleInstallLocalBrain"),vm.indexOf("const handleStartLocalBrain"));
 assert.ok(relevant.includes("await installLocalBrain()"));
 assert.ok(relevant.includes("await startLocalBrain()"));
 assert.ok(relevant.includes("if(!started.running)throw Error"));
 assert.ok(relevant.includes("registerLocalBrainProvider(started)"));
 assert.ok(!relevant.includes("setTimeout("));
 assert.ok(!relevant.includes("desktop_widget_open_main"));
});
test("bundled runtime release not misrepresented as completed",()=>{
 const config=JSON.parse(read("src-tauri/tauri.conf.json"));
 assert.ok(!config.bundle.resources.some((p:string)=>p.includes("local-brain-runtime")));
 const guide=read("docs/KATOSYNC_4_0_SETUP_RUNTIME_DESKTOP_WIDGET_2026-11-04.md");
 assert.ok(guide.includes("pending_review"));
 assert.ok(guide.includes("dynamische"));
});
