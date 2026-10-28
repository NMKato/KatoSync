// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const view=file("../src/components/MeshConnectionCard.tsx");
const section=view.slice(view.indexOf("function MeshConnectionCard()"));
test("rejected issuer session offers direct reauth instead of hiding behind Details",()=>{
 for(const f of ['"account"','"session"','"refresh"','"invalid"','"changed"'])
  assert.ok(section.includes(f));
 assert.match(section,/setDetailsOpen\(true\)/);
 assert.match(section,/setReauthOpen\(true\)/);
 assert.match(section,/open=\{reauthOpen\} onToggle=/);
 assert.match(section,/t\("mesh.simple.renewAction"\)/);
});
test("remediation cannot silently pair or expose secrets",()=>{
 const button=section.slice(section.indexOf("const revealReauth=()"),section.indexOf("const readiness="));
 assert.doesNotMatch(button,/mesh_local_approve_peer|save_supabase_refresh_token|mesh_pairing_offer_create|password/);
 assert.match(section,/type="password" autoComplete="current-password"/);
 assert.match(section,/import.meta.env.VITE_KATOOS_AUTH_QA==="1"/);
});
test("localized remediation",()=>{
 for(const lang of ["de","en","es","ru"])
  assert.ok(file("../src/i18n/locales/"+lang+".ts").includes('"mesh.simple.renewAction":'));
});
