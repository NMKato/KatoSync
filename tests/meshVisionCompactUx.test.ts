// Created by NMKato Solutions
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const view=read("../src/components/MeshConnectionCard.tsx");
const css=read("../src/styles.css");
const part=view.slice(view.indexOf("function MeshConnectionCard()"));

test("Vision Mesh has one compact primary Connect and Discover plus Details",()=>{
 assert.match(part,/vision-mesh-compact-top/);
 assert.match(part,/mesh\.simple\.disconnected/);
 assert.match(part,/onClick=\{\(\)=>void loadAccountDirectory\(\)\}/);
 assert.match(part,/onClick=\{\(\)=>void prepareAndInvite\(\)\}/);
 assert.match(part,/aria-expanded=\{detailsOpen\}/);
 assert.match(part,/id="vision-mesh-technical-details" hidden=\{!detailsOpen\}/);
 assert.equal((part.match(/onClick=\{\(\)=>void prepareAndInvite\(\)\}/g)||[]).length,1);
 assert.equal((part.match(/onClick=\{\(\)=>void loadAccountDirectory\(\)\}/g)||[]).length,1);
});

test("no fake connected or uptime label in stage zero",()=>{
 assert.match(part,/t\("mesh\.simple\.offerReady"\)/);
 assert.match(part,/t\("mesh\.simple\.discoveryNotReady"\)/);
 assert.match(part,/t\("mesh\.simple\.qualityUnknown"\)/);
 assert.match(part,/t\("mesh\.simple\.uptimeUnknown"\)/);
 assert.match(part,/actual\.peerTransport!=="not_connected"/);
 assert.match(part,/actual\.verifiedPeers!==0/);
 assert.match(part,/remoteReadOnlyDispatch/);
 assert.match(part,/crossDeviceWrites/);
 assert.doesNotMatch(part,/connectedAt\s*=\s*Date\.now/);
 assert.doesNotMatch(part,/setInterval/);
});

test("existing secure reauth, signature, SAS and revoke tools remain behind Details",()=>{
 for(const text of ["renew_katoos_qa_session","mesh_pairing_offer_create","mesh_pairing_challenge_create",
   "mesh_pairing_response_verify","mesh_local_revoke_peer","mesh_account_device_discover",
   "vision-mesh-reauth","vision-mesh-pairing","vision-mesh-approved"]){
   assert.ok(part.includes(text),text);
 }
 assert.match(css,/\.vision-mesh-technical\[hidden\]\{display:none;\}/);
 assert.match(css,/@media\(max-width:760px\)/);
});

test("short user-facing controls have de, en, es, ru translations",()=>{
 const keys=["title","disconnected","unavailable","noPeers","connect","details",
   "offerReady","discoveryNotReady","diagnostics","qualityUnknown","uptimeUnknown"];
 for(const lang of ["de","en","es","ru"]){
  const file=read("../src/i18n/locales/"+lang+".ts");
  for(const key of keys)assert.ok(file.includes('"mesh.simple.'+key+'":'),lang+":"+key);
 }
});
