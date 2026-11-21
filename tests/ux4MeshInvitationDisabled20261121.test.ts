// Created by NMKato Solutions – UX4 private pairing delivery remains explicit/fail-closed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const ui=source("src/components/AccountDevicesCard.tsx");
const copy=source("src/lib/accountMeshCopy.ts");
const rust=source("src-tauri/src/mesh_inbox.rs");
const build=source("scripts/build-ux4-mesh-qa-macos.sh");
test("UX4 first peer pairing cannot be initiated without explicit build opt-in",()=>{
  assert.match(ui,/import\.meta\.env\.VITE_MESH_INBOX_SEND_QA === "1"/);
  assert.match(ui,/firstPairingBlocked = !!selected && !approved\.includes\(selected\.fingerprint\) && !firstPairingSendAvailable/);
  assert.match(ui,/disabled=\{busy \|\| loading \|\| firstPairingBlocked\}/);
  assert.match(ui,/role="status">\{c\.pairingSendDisabled\}/);
  assert.match(ui,/onClick=\{\(\) => void model\.connect\(selected\.deviceId, mode\)\}/);
});
test("Already approved trusted peers can still choose to resume explicitly",()=>{
  assert.match(ui,/!approved\.includes\(selected\.fingerprint\)/);
  assert.match(ui,/hasMeshConnectionActivity\(state\)/);
  assert.match(ui,/onClick=\{\(\) => void model\.stop\(selected\.deviceId\)\}/);
});
test("Native sender remains additionally gated, with no hidden QA opt-in in existing builder",()=>{
  assert.match(rust,/option_env!\("KATOSYNC_MESH_INBOX_SEND_QA"\) == Some\("1"\)/);
  assert.match(rust,/!cfg!\(feature = "katoos-auth-qa"\) \|\| !send_qa_enabled\(\)/);
  assert.doesNotMatch(build,/export (?:VITE_MESH_INBOX_SEND_QA|KATOSYNC_MESH_INBOX_SEND_QA)=1/);
  assert.match(build,/UX4_MESH_PAIRING_PRIVATE_GATE_REQUIRES_SEPARATE_APPROVAL/);
  assert.match(build,/export VITE_MESH_INBOX_SEND_QA=0/);
  assert.match(build,/export VITE_MESH_INBOX_RECEIVE_QA=0/);
});
test("All four languages disclose why pairing is disabled without claiming device access",()=>{
  assert.match(copy,/pairingSendDisabled: "Private Pairing-Einladungen/);
  assert.match(copy,/pairingSendDisabled: "Private pairing invitations/);
  assert.match(copy,/pairingSendDisabled: "Las invitaciones privadas/);
  assert.match(copy,/pairingSendDisabled: "В этом тестовом выпуске/);
});
