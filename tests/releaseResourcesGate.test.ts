// NMKato Solutions – synthetic release-resource lock and hostile QA gates.
import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {verifyReleaseResources} from "../scripts/check-release-resources.mjs";
function fixture(target="win32-x64"){
 const root=mkdtempSync(join(tmpdir(),"katosync-release-"));
 const resource=join(root,"src-tauri","resources");
 const files=target.startsWith("win32")
  ?["poppler/pdftotext.exe","typst/typst.exe"]
  :["poppler/pdftotext","typst/typst","stt/KatoSyncSpeechHelper.app/Contents/MacOS/katosync-stt"];
 for(const sub of ["poppler","typst","stt"])mkdirSync(join(resource,sub),{recursive:true});
 const hashes={};
 for(const rel of files){
  const path=join(resource,rel);
  mkdirSync(dirname(path),{recursive:true});
  const content=target.startsWith("win32")?Buffer.from("4d5a00010102","hex"):Buffer.from("cffaedfe0102","hex");
  writeFileSync(path,content,{mode:0o755});
  hashes[rel]=createHash("sha256").update(content).digest("hex");
 }
 const lock={schemaVersion:1,target,files:hashes,features:{offlineDictation:false}};
 const save=()=>writeFileSync(join(root,"src-tauri","release-resources.lock.json"),JSON.stringify(lock));
 save();
 return {root,resource,lock,files,save};
}
test("release locks accept synthetic non-placeholder PE resources",async()=>{
 const f=fixture();
 try{assert.deepEqual(await verifyReleaseResources(f.root,"win32-x64"),{target:"win32-x64",verified:2});}
 finally{rmSync(f.root,{recursive:true,force:true});}
});
test("release rejects .test-only QA markers even when hashes are valid",async()=>{
 const f=fixture();
 try{
  writeFileSync(join(f.resource,"poppler",".test-only"),"QA");
  await assert.rejects(verifyReleaseResources(f.root,"win32-x64"),/RELEASE_QA_SENTINEL_FORBIDDEN/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("release rejects missing lock and mismatched checksums",async()=>{
 const f=fixture();
 try{
  f.lock.files[f.files[0]]="f".repeat(64);f.save();
  await assert.rejects(verifyReleaseResources(f.root,"win32-x64"),/RELEASE_SHA256_MISMATCH/);
  rmSync(join(f.root,"src-tauri","release-resources.lock.json"));
  await assert.rejects(verifyReleaseResources(f.root,"win32-x64"),/RELEASE_LOCK_MISSING/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("release rejects unspecified Windows STT policy",async()=>{
 const f=fixture();
 try{delete f.lock.features.offlineDictation;f.save();
  await assert.rejects(verifyReleaseResources(f.root,"win32-x64"),/RELEASE_WINDOWS_STT_MUST_BE_EXPLICITLY_DISABLED/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test("release rejects a lock for the wrong operating system",async()=>{
 const f=fixture("darwin-arm64");
 try{await assert.rejects(verifyReleaseResources(f.root,"win32-x64"),/RELEASE_LOCK_TARGET_OR_SCHEMA_INVALID/);}
 finally{rmSync(f.root,{recursive:true,force:true});}
});
test("release accepts pinned Mach-O resource fixture only with explicit executable bits",async()=>{
 const f=fixture("darwin-arm64");
 try{assert.deepEqual(await verifyReleaseResources(f.root,"darwin-arm64"),{target:"darwin-arm64",verified:3});}
 finally{rmSync(f.root,{recursive:true,force:true});}
});
