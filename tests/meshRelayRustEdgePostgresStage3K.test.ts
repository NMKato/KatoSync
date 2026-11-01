// NMKato Solutions – CI-safe Stage 3K fail-closed contract. Never starts PG.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=new URL("../",import.meta.url);
const read=(path:string)=>readFileSync(new URL(path,root),"utf8");

test("Stage 3K runner is blocked without explicit pre-existing Cargo target",()=>{
 const entry=new URL("../scripts/qa-mesh-rust-postgres-stage3k.mjs",import.meta.url);
 const result=spawnSync(process.execPath,[fileURLToPath(entry)],{
  cwd:fileURLToPath(new URL("../",import.meta.url)),
  env:{PATH:process.env.PATH??"",HOME:process.env.HOME??""},
  encoding:"utf8",timeout:6000
 });
 assert.notEqual(result.status,0);
 assert.match(result.stderr,process.platform==="darwin"?
  /STAGE3K_REQUIRES_EXISTING_CARGO_TARGET_DIR/:
  /STAGE3K_MACOS_PG17_QA_ONLY/);
});

test("Stage 3K local Postgres and Rust fixture lifecycle remain fail-closed",()=>{
 const runner=read("scripts/qa-mesh-rust-postgres-stage3k.mjs");
 const pg=read("scripts/qa-mesh-postgres-local.sh");
 const rust=read("src-tauri/src/mesh_relay_client.rs");
 const e2e=read("tests/meshRelayRustEdgePostgresStage3K.qa.ts");
 assert.match(runner,/--offline/);
 assert.match(runner,/EPHEMERAL_ONLY/);
 assert.match(runner,/rmSync\(temp/);
 assert.match(runner,/rmdirSync\(dir\)/);
 assert.match(runner,/rmdirSync\(placeholderDist\)/);
 assert.match(pg,/listen_addresses=''/);
 assert.match(pg,/trap cleanup EXIT INT TERM/);
 assert.match(pg,/inbox-relay-rust-e2e/);
 assert.match(rust,/KATOSYNC_STAGE3K_FRESH_TEST_TIME/);
 assert.match(rust,/2_000_000_000_i64/);
 assert.match(e2e,/STAGE3K_NO_EXTERNAL_NETWORK/);
 assert.match(e2e,/SET ROLE service_role/);
 assert.match(e2e,/STAGE3K_DISPOSABLE_SOCKET_REQUIRED/);
 assert.match(e2e,/paired,payload.transportReady,payload.remoteJobsEnabled/);
});
