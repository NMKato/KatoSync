// Created by NMKato Solutions – Stage4AA QA security boundary.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../",import.meta.url);
const source=readFileSync(new URL("src-tauri/src/mesh_tailnet_qa.rs",root),"utf8");
const lan=readFileSync(new URL("src-tauri/src/mesh_private_lan_qa.rs",root),"utf8");
const entry=readFileSync(new URL("src-tauri/src/lib.rs",root),"utf8");

test("Stage4AA is QA-only CLI; no Tauri IPC or production entrypoint",()=>{
 assert.match(entry,/\#\[cfg\(feature = "stage4j-qa"\)\]\s*mod mesh_tailnet_qa;/);
 assert.match(entry,/--stage4aa-tailnet-qa-once/);
 assert.match(entry,/mesh_tailnet_qa::run_once/);
 assert.doesNotMatch(source,/\#\[tauri::command\]/);
 assert.doesNotMatch(entry,/mesh_tailnet_qa::\w+\s*,/);
});

test("requires both owner opt-ins and single-use concurrency without opening existing Stage4W gate",()=>{
 assert.match(source,/KATOSYNC_STAGE4AA_TAILNET_QA_ONCE/);
 assert.match(source,/OWNER_LAUNCHED_TAILNET_QA_ONLY/);
 assert.match(source,/KATOSYNC_STAGE4W_LAN_QA_ONCE/);
 assert.match(source,/OWNER_LAUNCHED_QA_ONLY/);
 assert.match(source,/SingleQaPermit::acquire/);
 assert.match(lan,/fn private_same_subnet/);
 assert.match(lan,/a\.octets\(\)\[\.\.3\] == b\.octets\(\)\[\.\.3\]/);
});

test("restricts to locally verified live Tailscale peer and exact source IP, not CGNAT alone",()=>{
 assert.match(source,/100.*64\.\.=127/);
 assert.match(source,/BackendState/);
 assert.match(source,/TailscaleIPs/);
 assert.match(source,/UserID/);
 assert.match(source,/Online/);
 assert.match(source,/matches\.len\(\) != 1/);
 assert.match(source,/socket\.local_addr/);
 assert.match(source,/socket\.peer_addr/);
 assert.match(source,/source\.ip\(\)/);
 assert.match(source,/TAILSCALE_MACOS_BIN/);
 assert.match(source,/Command::new\(TAILSCALE_MACOS_BIN\)/);
 assert.doesNotMatch(source,/\/bin\/(?:sh|bash)|Command::new\("sh"\)/);
});

test("reuses real canonical account, Keychain pin, enrollment and pinned mTLS, never remote rights",()=>{
 assert.match(source,/owner_qa_identity\(pin\)/);
 assert.match(source,/mesh_admission::probe_server_after_approval/);
 assert.match(source,/mesh_admission::probe_client_after_approval/);
 assert.match(source,/read_cert/);
 assert.match(source,/write_cert/);
 assert.match(source,/verify_live_tailnet/);
 assert.doesNotMatch(source,/create_identity|save_peer|remote_job|execute_command|File::create|LaunchAgent/);
 assert.match(entry,/MESH_STAGE4AA_PINNED_MTLS_ONCE_PASS_NO_REMOTE/);
});

test("strict native negative tests deny spoofed, invalid, duplicate and offline overlay",()=>{
 for(const name of [
 "two_explicit_owner_flags_and_qa_feature_are_mandatory",
 "only_distinct_tailnet_ips_and_ephemeral_unprivileged_ports",
 "daemon_snapshot_requires_live_self_exact_online_peer_and_same_user",
 "duplicate_peer_ip_spoof_expired_or_disabled_tailnet_fail_closed"
 ]) assert.ok(source.includes("fn "+name+"("),name);
});
