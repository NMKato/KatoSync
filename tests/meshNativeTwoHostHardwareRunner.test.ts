// NMKato Solutions / Stage 3C. CI never makes LAN connections.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const runner=fileURLToPath(new URL("../scripts/qa-mesh-native-two-host.sh",import.meta.url));
const script=readFileSync(runner,"utf8");
const rust=readFileSync(new URL("../src-tauri/src/mesh_transport.rs",import.meta.url),"utf8");
test("native LAN launcher denies unauthorized invocations before any port is opened",()=>{
 assert.match(script,/SYNTHETIC_OPT_IN_REQUIRED/);
 assert.match(script,/EXTRA_ARGUMENTS_DENIED/);
 assert.match(script,/ROLE_DENIED/);
 assert.match(script,/CLOUD_KEYS_DENIED/);
 assert.match(script,/REAL_CERT_OR_KEY_ENV_DENIED/);
 assert.match(script,/EXPLICIT_ADDRESSES_REQUIRED/);
 assert.match(script,/EXPLICIT_PREBUILT_TARGET_REQUIRED/);
 if(process.platform!=="darwin")return;
 const env={PATH:process.env.PATH??"/usr/bin:/bin",HOME:"/tmp"};
 const first=spawnSync("bash",[runner],{env,encoding:"utf8",timeout:3000});
 assert.equal(first.status,2);
 assert.match(first.stderr,/SYNTHETIC_OPT_IN_REQUIRED/);
 const second=spawnSync("bash",[runner,"--all"],{env:{
  ...env,KATOSYNC_MESH_LAN_QA_ALLOW:"SYNTHETIC_FIXTURES_ONLY"
 },encoding:"utf8",timeout:3000});
 assert.equal(second.status,2);
 assert.match(second.stderr,/EXTRA_ARGUMENTS_DENIED/);
});
test("hardware test is ignored by default, local-only and pinned to a synthetic identity pair",()=>{
 assert.match(rust,/#\[ignore = "manual two-machine LAN QA: synthetic test keys, explicit one-shot private socket only"\]/);
 assert.match(rust,/let a = signing\(41\)/);
 assert.match(rust,/let b = signing\(42\)/);
 assert.match(rust,/allowed_private_lan_fixture\(&role, address, expected_ip\)/);
 assert.match(rust,/assert_eq!\(peer\.ip\(\), expected_ip/);
 assert.match(rust,/assert_eq!\(\s*socket\.peer_addr\(\)\.unwrap\(\)\.ip\(\),\s*expected_ip/);
 assert.match(rust,/Duration::from_secs\(45\)/);
 assert.match(script,/--offline/);
 assert.match(script,/--ignored --exact --nocapture --test-threads=1/);
 assert.doesNotMatch(script,/\b(?:ssh|scp|curl|supabase|security)\s+(?:exec|db|functions|add-generic-password|delete-generic-password)/);
});
test("wrong certificate pin is rejected at cryptographic identity binding, not a generic timeout",()=>{
 assert.match(rust,/client-wrong-pin/);
 assert.match(rust,/Some\("TLS-Zertifikat gehört nicht zur freigegebenen Geräteidentität\."\)/);
 assert.match(rust,/Wrong pinned key must fail at peer certificate binding/);
 assert.match(rust,/assert!\(result\.is_err\(\), "Negative TLS probe unexpectedly succeeded"\)/);
});
test("positive and negative hardware scenarios cannot authorize trust or remote jobs",()=>{
 assert.match(rust,/readiness\["verifiedPeers"\], 0/);
 assert.match(rust,/readiness\["remoteReadOnlyDispatch"\], false/);
 assert.match(rust,/readiness\["crossDeviceWrites"\], false/);
 assert.match(script,/KATOSYNC_MESH_LAN_QA_NEGATIVE/);
 assert.match(script,/CLIENT_NEGATIVE_FLAG_DENIED/);
 assert.match(rust,/client_probe\(socket/);
 assert.match(rust,/server_probe\(socket/);
});
