import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/mesh_agent_bootstrap.rs",import.meta.url),"utf8");
const bridge=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
test("hardware bootstrap probes locally, verifies account and never claims trust",()=>{
 assert.ok(rust.includes('Command::new("/usr/sbin/sysctl")'));
 assert.ok(rust.includes("available_parallelism"));
 assert.ok(rust.includes("verified_katosync_user"));
 assert.ok(rust.includes("same_account_still_verified"));
 assert.ok(rust.includes('local_model_status: "not_verified"'));
 assert.ok(rust.includes("transport_ready: false"));
 assert.ok(rust.includes("remote_jobs_enabled: false"));
 assert.ok(bridge.includes("mesh_agent_bootstrap::mesh_agent_bootstrap_snapshot"));
});
