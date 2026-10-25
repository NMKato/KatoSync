// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(filename:string)=>readFileSync(new URL(filename,import.meta.url),"utf8");
const bridge=read("../src-tauri/src/offline_stt.rs");
const swift=read("../src-tauri/resources/stt/katosync-stt.swift");
const styles=read("../src/styles.css");
const ui=read("../src/components/ContinuityLocalChatPanel.tsx");
test("Stop signal ends capture, then local model finalizes transcription",()=>{
 assert.match(swift,/stopRequested=true/);
 assert.match(swift,/engine\.stop\(\)/);
 assert.match(swift,/request\.endAudio\(\)/);
 assert.match(swift,/emit\("complete"/);
 assert.match(bridge,/local_stt_stop/);
 assert.match(bridge,/write_all\s*\(\s*b"STOP\\n"/);
 assert.match(bridge,/SESSION\.lock\(\)\.await/);
 assert.match(bridge,/active\.id\s*!=\s*id/);
});
test("Mac helper uses own signed Info.plist with permission descriptions",()=>{
 const build=read("../scripts/build-stt-macos.mjs");
 assert.match(build,/KatoSyncSpeechHelper\.app/);
 assert.match(build,/Contents\/Info\.plist/);
 assert.match(build,/CFBundleIdentifier/);
 assert.match(build,/NSMicrophoneUsageDescription/);
 assert.match(build,/NSSpeechRecognitionUsageDescription/);
 assert.match(build,/codesign/);
});
test("Record button is red and provides visible stop, progress and differentiated errors",()=>{
 assert.match(ui,/sttStage==="recording"/);
 assert.match(ui,/sttStage==="processing"/);
 assert.match(ui,/sttStage==="permission"/);
 assert.match(ui,/sttStage==="error"/);
 assert.match(ui,/t\("continuity\.chat\.sttStop"\)/);
 assert.match(ui,/onClick=\{\(\)=>void \(recording/);
 assert.match(ui,/sttElapsed/);
 assert.match(ui,/setSttErrorCode\(payload\.code/);
 assert.match(styles,/\.continuity-voice-button\.is-recording/);
 assert.match(styles,/\.continuity-record-dot/);
 assert.match(styles,/backdrop-filter:blur\(18px\)/);
});
test("Dictated output is only inserted into composer; never auto-sends",()=>{
 assert.match(ui,/setQuestion\(old=>/);
 assert.match(ui,/sttProjectRef\.current===projectRef\.current/);
 assert.doesNotMatch(swift,/https:\/\//);
 assert.doesNotMatch(bridge,/reqwest/);
 assert.doesNotMatch(bridge,/continuity_chat_send/);
});
