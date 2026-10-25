// Created by NMKato Solutions
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {chmodSync} from "node:fs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
if(process.platform==="darwin"){
  const input=resolve(root,"src-tauri/resources/stt/katosync-stt.swift");
  const output=resolve(root,"src-tauri/resources/stt/katosync-stt");
  execFileSync("xcrun",["swiftc","-O",input,"-o",output],{stdio:"inherit"});
  chmodSync(output,0o755);
  console.log("macOS on-device dictation helper built");
}else{
  console.log("Skipping macOS Speech helper on this platform");
}
