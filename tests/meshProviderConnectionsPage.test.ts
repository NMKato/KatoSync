// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const vision=src("../src/components/VisionWorkspace.tsx");
const provider=src("../src/components/ProviderManager.tsx");
const mesh=src("../src/components/MeshConnectionCard.tsx");
const app=src("../src/App.tsx");
test("Vision canvas remains clean",()=>{
 assert.ok(vision.includes("<VisionCanvas "));
 assert.ok(!vision.includes("MeshConnectionCard"));
 assert.ok(!vision.includes("renew_katoos_qa_session"));
});
test("Connections page mounts account devices under the signed-in gate alongside model and GitHub connections",()=>{
 // Die Kontogerätekarte ersetzt den alten, stets ungepaarten V0-Diagnosestand.
 const signedInBlocks=[...provider.matchAll(/\{vm\.sessionStatus\.loggedIn\s*\?\s*\(([\s\S]*?)\)\s*:\s*null\}/g)]
   .map(match=>match[1]);
 const devices=signedInBlocks.find(block=>/<AccountDevicesCard\b/.test(block));
 const ownerReview=signedInBlocks.find(block=>/<RemoteMcpOwnerConsentCard\b/.test(block));
 assert.ok(devices,"Kontogeräte müssen innerhalb des angemeldeten Bereichs liegen");
 assert.ok(ownerReview,"Owner-MCP-Review muss einzeln angemeldet eingebunden bleiben");
 assert.match(devices,/<AccountDevicesCard\s+refreshEpoch=\{connectionRefreshEpoch\}\s*\/>/);
 assert.match(ownerReview,/<RemoteMcpOwnerConsentCard\b[^>]*refreshEpoch=\{connectionRefreshEpoch\}[^>]*\/>/);
 assert.match(devices,/hidden=\{visibleDetail !== "devices"\}/);
 assert.match(ownerReview,/hidden=\{visibleDetail !== "mcp"\}/);
 assert.equal((provider.match(/<AccountDevicesCard\b/g)??[]).length,1);
 assert.doesNotMatch(provider,/<MeshConnectionCard\b/);
 assert.ok(provider.includes("GithubAppConnectionPanel"));
 assert.ok(provider.includes("cardProviders"));
});
test("A single account mesh provider persists across gateway and workspace navigation",()=>{
 const opening=/<AccountMeshProvider\b[^>]*>/.exec(app);
 assert.ok(opening,"Der Kontokontext muss Gateway und Arbeitsbereiche umschließen");
 assert.equal((app.match(/<AccountMeshProvider\b/g)??[]).length,1);
 assert.equal((app.match(/<\/AccountMeshProvider>/g)??[]).length,1);
 assert.match(opening[0],/key=\{vm\.sessionStatus\.email\s*\?\?\s*"signed-in-account"\}/);
 assert.doesNotMatch(opening[0],/workspaceMode|visibleStep|activeStep/);
 const closing=app.indexOf("</AccountMeshProvider>",opening.index);
 assert.ok(closing>opening.index);
 const sharedScope=app.slice(opening.index+opening[0].length,closing);
 assert.match(sharedScope,/\{\s*!workspaceMode\s*\?\s*\(/);
 for(const component of ["ModeGateway","ProviderManager","AccountDeviceNotifications"]){
   assert.ok(sharedScope.includes("<"+component),"Gemeinsamer Kontokontext fehlt für "+component);
 }
});
test("Legacy Mesh-v0 component preserves secure backend gates",()=>{
 assert.ok(mesh.includes("roster.discoveryOnly!==true"));
 assert.ok(mesh.includes("roster.transportReady!==false"));
 assert.ok(mesh.includes('actual.peerTransport!=="not_connected"'));
 assert.ok(mesh.includes("hidden={!detailsOpen}"));
});
