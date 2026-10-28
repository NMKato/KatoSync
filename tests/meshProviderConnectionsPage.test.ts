import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const vision=src("../src/components/VisionWorkspace.tsx");
const provider=src("../src/components/ProviderManager.tsx");
const mesh=src("../src/components/MeshConnectionCard.tsx");
test("Vision canvas remains clean",()=>{
 assert.ok(vision.includes("<VisionCanvas "));
 assert.ok(!vision.includes("MeshConnectionCard"));
 assert.ok(!vision.includes("renew_katoos_qa_session"));
});
test("Provider contains model, GitHub and Mesh connections",()=>{
 assert.ok(provider.includes("<MeshConnectionCard />"));
 assert.ok(provider.includes("GithubAppConnectionPanel"));
 assert.ok(provider.includes("cardProviders"));
});
test("Mesh card preserves secure backend gates",()=>{
 assert.ok(mesh.includes("roster.discoveryOnly!==true"));
 assert.ok(mesh.includes("roster.transportReady!==false"));
 assert.ok(mesh.includes('actual.peerTransport!=="not_connected"'));
 assert.ok(mesh.includes("hidden={!detailsOpen}"));
});
