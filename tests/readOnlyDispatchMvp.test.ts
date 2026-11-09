// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
const native=read("../src-tauri/src/read_only_dispatch.rs");
const app=read("../src-tauri/src/lib.rs");
const panel=read("../src/components/ReadOnlyDispatchPanel.tsx");
const jobs=read("../src/components/AgentSyncWorkspace.tsx");

test("MVP single read-only dispatch is wired to Jobs & Queue, not the old writable runner",()=>{
 assert.match(app,/read_only_dispatch::readonly_dispatch_probe/);
 assert.match(app,/read_only_dispatch::readonly_probe_preflight/);
 assert.match(app,/read_only_dispatch::readonly_probe_history/);
 assert.match(jobs,/<ReadOnlyDispatchPanel projects=\{vm.projects.registry.projects\}/);
 assert.match(panel,/invoke<Probe>\("readonly_dispatch_probe"/);
 assert.match(panel,/invoke<Probe\[]>\("readonly_probe_history"/);
 assert.doesNotMatch(panel,/runCodexTask|run_codex_task|handleStartBoardQueue/);
 assert.match(native,/static ACTIVE_PROBE: AtomicBool/);
 assert.match(native,/compare_exchange\(false, true/);
});
test("Runner gets only a bounded metadata prompt, no repo path or source file reads",()=>{
 assert.match(native,/fn clean_prompt\(snapshot: &GitProof\)/);
 assert.match(native,/No path or project file content passes to Codex/);
 assert.match(native,/--sandbox"[\s\S]*?"read-only"/);
 assert.match(native,/--ephemeral/);
 assert.match(native,/--permission-mode"[\s\S]*?"plan"/);
 assert.match(native,/--tools"[\s\S]*?""/);
 assert.match(native,/--strict-mcp-config/);
 assert.match(native,/--no-session-persistence/);
 assert.match(native,/current_dir\(neutral\)/);
 assert.doesNotMatch(native,/checkout",|git init|git add|git commit|git push|--dangerously-skip-permissions|sandbox_workspace_write/);
});
test("Git status is read without optional locks and verified before/after",()=>{
 assert.match(native,/--no-optional-locks/);
 assert.match(native,/GIT_OPTIONAL_LOCKS", "0"/);
 assert.match(native,/let before = git_proof\(&repo\)/);
 assert.match(native,/let after = git_proof\(&repo\)/);
 assert.match(native,/before != after/);
 assert.match(native,/project_registry::project_registry_load/);
 assert.match(native,/rootPath/);
 assert.match(native,/verified_katosync_user\(\)\.await/);
 assert.match(native,/read-only/);
});
test("Trace is persisted per verified account and only explicit operator click dispatches",()=>{
 assert.match(native,/readonly-dispatch-v1/);
 assert.match(native,/Uuid::new_v4/);
 assert.match(native,/persist_record\(&app, &uid, &record\)/);
 assert.match(panel,/disabled=\{busy\|\|!selected\}/);
 assert.match(panel,/onClick=\{\(\)=>void run\(\)\}/);
 assert.doesNotMatch(panel,/useEffect\(\(\)=>\s*void run\(/);
});

test("Native preflight is isolated from model invocation, redacts native errors and uses identical validation gates",()=>{
 const backend=read("../src-tauri/src/read_only_dispatch.rs");
 assert.match(backend,/pub async fn readonly_probe_preflight\(req: ReadOnlyProbeRequest\)/);
 assert.match(backend,/match validated_probe\(&req\)\.await/);
 assert.match(backend,/let \(uid, repo, trusted_name, before\) = validated_probe\(&req\)/);
 const segment=backend.split("pub async fn readonly_probe_preflight")[1].split("#[tauri::command]")[0];
 assert.doesNotMatch(segment,/\.output\(\)|\.spawn\(\)|prepare_command|run_codex_task/);
 assert.match(backend,/map_err\(\|_\| "RO_AUTH"\)/);
 assert.match(backend,/map_err\(\|_\| "RO_GIT"\)/);
 assert.match(backend,/map_err\(\|_\| "RO_HISTORY"\.to_string\(\)\)/);
 const panel=read("../src/components/ReadOnlyDispatchPanel.tsx");
 assert.match(panel,/invoke<Preflight>\("readonly_probe_preflight"/);
 assert.match(panel,/readonly\.preflight/);
 assert.match(panel,/readonly\.errorAuth/);
 assert.match(panel,/readonly\.errorGit/);
 assert.match(panel,/readonly\.errorHistory/);
 assert.match(panel,/setError\(safeError\(String\(cause\)\)\)/);
 assert.doesNotMatch(panel,/setError\(String\(cause\)\)/);
});

test("Provider CLI preflight handles limited macOS GUI PATH and failures persist categorized receipts",()=>{
 const native=read("../src-tauri/src/read_only_dispatch.rs");
 const panel=read("../src/components/ReadOnlyDispatchPanel.tsx");
 assert.match(native,/fn provider_executable\(provider: &str\)/);
 assert.match(native,/\.join\("\.local"\)\.join\("bin"\)/);
 assert.match(native,/provider_executable\(&req\.provider\)\?/);
 assert.match(native,/RO_PROVIDER_START/);
 assert.match(native,/RO_PROVIDER_EXIT/);
 assert.match(native,/RO_REPLY_INVALID/);
 assert.match(native,/RO_SCRATCH/);
 assert.match(native,/failure_code: failure_code\.map\(str::to_string\)/);
 assert.match(native,/serde\(default, skip_serializing_if = "Option::is_none"\)/);
 assert.match(panel,/job\.failureCode/);
 assert.match(panel,/readonly\.errorProviderStart/);
 assert.doesNotMatch(native,/\.stderr\(Stdio::piped\(\)\)/);
});
