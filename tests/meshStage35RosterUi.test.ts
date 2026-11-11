import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const ui=read("src/components/MeshConnectionCard.tsx");
test("Stage35 roster distinguishes cryptographic app registrations from physical devices",()=>{
 assert.ok(ui.includes("presentMeshRegistrations({"));
 assert.ok(ui.includes("presentation.recentlyReported.map(renderRegistration)"));
 assert.ok(ui.includes("presentation.olderEntries.map(renderRegistration)"));
 assert.ok(ui.includes("displayRegistrationName(presentation.own)"));
 assert.ok(ui.includes('t("mesh.directory.identityCount"'));
 assert.ok(ui.includes('t("mesh.directory.older"'));
 assert.ok(!ui.includes("physicalDevices:directory.devices.length"));
});
test("the own current app identity cannot be selected as the target peer",()=>{
 assert.ok(ui.includes("d.fingerprint!==agentBootstrap?.fingerprint"));
 assert.ok(ui.includes("presentation.recentlyReported.map(renderRegistration)"));
 assert.ok(!ui.includes("presentation.own.deviceId===selectedDeviceId"));
});
test("discovered QA identity is not described as a trusted colleague",()=>{
 assert.ok(ui.includes('colleagueRecommendation?.stage==="ready_for_hello"'));
 assert.ok(ui.includes('t("mesh.agent35.accountRecords"'));
 assert.ok(ui.includes('t(locallyPaired?"mesh.status.helloBlocked":"mesh.agent35.pendingTrust")'));
 assert.ok(ui.includes("secureTransportReady:false"));
});
test("all four UI languages distinguish app identity from physical computer",()=>{
 for(const lang of ["de","en","es","ru"]){
  const locale=read("src/i18n/locales/"+lang+".ts");
  for(const key of ["identityCount","own","registered","recent","older","olderNotice"]){
   assert.ok(locale.includes('"mesh.directory.'+key+'":'),lang+" "+key);
  }
  assert.ok(locale.includes('"mesh.agent35.accountRecords":'));
 }
});
