// Created by NMKato Solutions
// Produce an actual macOS helper .app with its OWN privacy descriptions for TCC.
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {mkdirSync,writeFileSync,chmodSync,rmSync} from "node:fs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
if(process.platform==="darwin"){
  const input=resolve(root,"src-tauri/resources/stt/katosync-stt.swift");
  const bundle=resolve(root,"src-tauri/resources/stt/KatoSyncSpeechHelper.app");
  const macOS=resolve(bundle,"Contents/MacOS");
  const output=resolve(macOS,"katosync-stt");
  rmSync(bundle,{recursive:true,force:true});
  mkdirSync(macOS,{recursive:true});
  writeFileSync(resolve(bundle,"Contents/Info.plist"), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '<key>CFBundleIdentifier</key><string>com.nmkato.katosync.speech-helper</string>',
    '<key>CFBundleName</key><string>KatoSync Offline-Diktat</string>',
    '<key>CFBundleExecutable</key><string>katosync-stt</string>',
    '<key>CFBundlePackageType</key><string>APPL</string>',
    '<key>CFBundleVersion</key><string>1</string>',
    '<key>CFBundleShortVersionString</key><string>1.0.0</string>',
    '<key>LSUIElement</key><true/>',
    '<key>NSMicrophoneUsageDescription</key>',
    '<string>KatoSync nimmt Sprache nur für ein von dir gestartetes Offline-Diktat auf.</string>',
    '<key>NSSpeechRecognitionUsageDescription</key>',
    '<string>KatoSync wandelt gesprochene Fragen ausschließlich auf dem Mac in Text um.</string>',
    '</dict></plist>'
  ].join("\n"));
  execFileSync("xcrun",["swiftc","-O",input,"-o",output],{stdio:"inherit"});
  chmodSync(output,0o755);
  // Temporary ad-hoc QA signature; stable releases use Developer ID / notarization.
  execFileSync("codesign",["--force","--sign","-",bundle],{stdio:"inherit"});
  console.log("macOS on-device dictation helper app built and signed");
}else{
  console.log("macOS-only dictation helper not packaged on this platform");
}
