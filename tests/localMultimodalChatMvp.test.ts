// Created by NMKato Solutions
import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
const source=(name:string)=>readFileSync(new URL(name,import.meta.url),"utf8");
const local=source("../src-tauri/src/local_brain.rs");
const bridge=source("../src-tauri/src/memory_fabric/continuity_bridge.rs");
const chat=source("../src/components/ContinuityLocalChatPanel.tsx");

test("Gemma loads only verified local projector and reports true native vision capability",()=>{
  assert.match(local,/fn verified_projector_file/);
  assert.match(local,/item\.size_bytes/);
  assert.match(local,/digest\.finalize/);
  assert.match(local,/command\.arg\("--mmproj"\)/);
  assert.match(local,/vision_service_ready\(\)\.await/);
  assert.match(local,/pointer\("\/modalities\/vision"\)/);
});
test("Image travels as image_url into local model, not into Cloud or Memory Fabric raw attachment",()=>{
  assert.match(bridge,/fn validated_image_data_url/);
  assert.match(bridge,/bytes\.starts_with\(signature\)/);
  assert.match(bridge,/image_url\.is_some\(\)/);
  assert.match(bridge,/Bild lokal analysiert; Datei nicht gespeichert/);
  assert.match(local,/grounded_chat_with_project_image/);
  assert.match(local,/"type":"image_url"/);
  assert.doesNotMatch(bridge,/reqwest::Client/);
});
test("Photo attach is explicitly gated by running native vision and never auto sends",()=>{
  assert.match(chat,/invoke<BrainCapabilities>\("local_brain_status"/);
  assert.match(chat,/status\.running&&status\.visionReady/);
  assert.match(chat,/FileReader\(\)/);
  assert.match(chat,/canvas\.toDataURL/);
  assert.match(chat,/disabled=\{busy\|\|!loaded\|\|!visionReady\}/);
  assert.match(chat,/onClick=\{\(\)=>uploadRef\.current\?\.click\(\)\}/);
});
test("Safe markdown and HTML rendering disable remote images, links, scripts and network access",()=>{
  assert.match(chat,/ReactMarkdown remarkPlugins=\{\[remarkGfm\]\} skipHtml/);
  assert.match(chat,/img:\(\)=>null/);
  assert.match(chat,/a:\(\{children\}\)=>/);
  assert.match(chat,/sandbox=""/);
  assert.match(chat,/default-src 'none'/);
  assert.match(chat,/connect-src 'none'/);
});

test("macOS dictation is native, on-device, stoppable and composer-only",()=>{
 const native=source("../src-tauri/src/offline_stt.rs");
 const swift=source("../src-tauri/resources/stt/katosync-stt.swift");
 const app=source("../src-tauri/src/lib.rs");
 const pack=source("../scripts/build-stt-macos.mjs");
 assert.match(swift,/requiresOnDeviceRecognition=true/);
 assert.match(swift,/supportsOnDeviceRecognition/);
 assert.match(swift,/SFSpeechRecognizer\.requestAuthorization/);
 assert.match(swift,/readLine\(\)/);
 assert.match(swift,/"STOP"/);
 assert.match(swift,/emit\("recording"\)/);
 assert.match(swift,/emit\("processing"\)/);
 assert.match(native,/Command::new\(bin\)/);
 assert.match(native,/kill_on_drop\(true\)/);
 assert.match(native,/local_stt_start/);
 assert.match(native,/local_stt_stop/);
 assert.match(native,/local_stt_preflight/);
 assert.match(native,/STT_EVENT/);
 assert.match(native,/write_all\s*\(\s*b"STOP\\n"/);
 assert.match(app,/offline_stt::local_stt_start/);
 assert.match(app,/offline_stt::local_stt_stop/);
 assert.match(chat,/invoke\("local_stt_start"/);
 assert.match(chat,/invoke\("local_stt_stop"/);
 assert.match(chat,/listen<SttEvent>/);
 assert.match(chat,/setQuestion\(old=>/);
 assert.match(chat,/is-recording/);
 assert.match(chat,/continuity-record-dot/);
 assert.match(pack,/KatoSyncSpeechHelper\.app/);
 assert.match(pack,/NSSpeechRecognitionUsageDescription/);
 assert.match(pack,/NSMicrophoneUsageDescription/);
 assert.doesNotMatch(native,/https:\/\//);
});

test("clipboard screenshot and drag/drop stay in local-only image preprocessing",()=>{
 assert.match(chat,/onPaste=\{\(event\)=>/);
 assert.match(chat,/onDrop=\{event=>/);
 assert.match(chat,/void pickImage\(image\)/);
 assert.match(chat,/event\.preventDefault\(\)/);
});
