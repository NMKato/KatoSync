// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const native=file("../src-tauri/src/memory_fabric/continuity_bridge.rs");
const chat=file("../src/components/ContinuityLocalChatPanel.tsx");
const lib=file("../src-tauri/src/lib.rs");

test("Native chat diagnostics are read-only and repair is a distinct explicit command",()=>{
 assert.ok(lib.includes("continuity_bridge::continuity_chat_diagnostics"));
 assert.ok(lib.includes("continuity_bridge::continuity_chat_repair_project"));
 assert.ok(native.includes("pub(crate) async fn continuity_chat_diagnostics("));
 const diagnostic=native.split("pub(crate) async fn continuity_chat_diagnostics")[1].split("pub(crate) async fn continuity_chat_repair_project")[0];
 assert.ok(!diagnostic.includes("open_store()"));
 assert.ok(!diagnostic.includes("VACUUM"));
 assert.ok(native.includes("if !accepted_backup"));
 assert.ok(native.includes("WRITE_LOCK"));
 assert.ok(native.includes("project_repair_state(&project_id, &root)"));
});
test("Old database and changed root require matching normalized repo identity",()=>{
 assert.ok(native.includes("old_remote != current_remote"));
 assert.ok(native.includes("foreign_repository"));
 assert.ok(native.includes("project_registry::project_registry_load()"));
 assert.ok(native.includes("collected.root_fingerprint"));
 assert.ok(native.includes("MemoryStore::open_read_only"));
});
test("Verified backup precedes schema migration and reindex",()=>{
 const copy=native.indexOf("VACUUM main INTO ?1");
 const verify=native.indexOf("PRAGMA quick_check");
 const migrate=native.indexOf("let mut store = open_store()?; // performs atomic");
 const ingest=native.indexOf("store.ingest(");
 assert.ok(copy>0 && verify>copy && migrate>verify && ingest>migrate);
 assert.ok(native.includes("fs::set_permissions(&backup"));
 assert.ok(native.includes("Permissions::from_mode(0o600)"));
 assert.ok(native.includes("backup_dir"));
});
test("UI blocks chat when history fails and requires affirmative backup consent",()=>{
 assert.ok(chat.includes("continuity_chat_diagnostics"));
 assert.ok(chat.includes("continuity_chat_repair_project"));
 assert.ok(chat.includes("disabled={!acceptBackup||repairing||busy}"));
 assert.ok(chat.includes("acceptedBackup:true"));
 assert.ok(chat.includes("setLoaded(false)"));
 assert.ok(chat.includes("disabled={busy || !loaded"));
 assert.ok(chat.includes("await refresh()"));
});
