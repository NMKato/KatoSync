// Created by NMKato Solutions
// Stage4J: neither a double-spawn nor a foreign-service kill may occur.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const source=read("src-tauri/src/local_brain.rs");
const manifest=JSON.parse(read("src/lib/localBrainManifest.json"));

test("Local Brain serializes full asynchronous model start and controlled stop",()=>{
  assert.match(source,/static MODEL_START_LOCK: tokio::sync::Mutex<\(\)>/);
  assert.match(source,/pub async fn start\(app: &AppHandle\)[\s\S]*?let _model_start_guard = MODEL_START_LOCK\.lock\(\)\.await;/);
  assert.match(source,/pub async fn stop\(app: &AppHandle\)[\s\S]*?MODEL_START_LOCK\.lock\(\)\.await;/);
});

test("an unknown occupied KatoSync port fails closed without killing foreign server",()=>{
  assert.match(source,/local_brain_port_occupied\("127\.0\.0\.1:17842"\)/);
  assert.match(source,/Local-Brain-Port 17842 ist durch einen anderen Dienst belegt/);
  assert.match(source,/TcpStream::connect_timeout/);
  assert.match(source,/fn local_brain_port_occupation_is_detected_without_killing_other_processes/);
});

test("RAM minimum applies to actual model start, not just status labels",()=>{
  assert.match(source,/let detected_ram_gb = detect_ram_gb\(\)/);
  assert.match(source,/detected_ram_gb < model\.minimum_ram_gb/);
});

test("secondary model requires a separate pinned release contract; never auto-load on GUI boot",()=>{
  assert.ok(Array.isArray(manifest.models));
  assert.ok(manifest.models.some((m:any)=>m.recommended===true));
  assert.ok(manifest.models.every((m:any)=>/^[a-f0-9]{64}$/.test(m.sha256) && m.sizeBytes>0));
  assert.match(source,/pub async fn start\(app: &AppHandle\)/);
  assert.doesNotMatch(source,/pub fn auto_load_two_models\(/);
});
