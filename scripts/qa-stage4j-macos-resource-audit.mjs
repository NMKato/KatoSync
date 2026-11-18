// NMKato Solutions — Stage4J macOS Arm64 QA resource audit.
// READ ONLY. Never trusts SHA locks without file checks or allows Homebrew
// absolute runtime dependencies. Does not sign, install, upload or run services.
import {createHash} from "node:crypto";
import {execFileSync,spawnSync} from "node:child_process";
import {createReadStream,existsSync,lstatSync,readFileSync,realpathSync,readdirSync} from "node:fs";
import {join,resolve,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {verifyReleaseResources} from "./check-release-resources.mjs";

function reject(why){throw new Error("STAGE4J_RESOURCE_BLOCKED_"+why);}
async function digest(f){
 const sha=createHash("sha256");
 for await(const chunk of createReadStream(f))sha.update(chunk);
 return sha.digest("hex");
}
function regularWithoutSymlink(path){
 const info=lstatSync(path);
 if(!info.isFile()||info.isSymbolicLink()||realpathSync(path)!==path)reject("SYMLINK_OR_NOT_FILE");
}
function macLibraryDependencies(file){
 const lines=execFileSync("otool",["-L",file],{encoding:"utf8",timeout:3000,maxBuffer:1024*1024}).split("\n").slice(1);
 return lines.map(v=>v.trim().split(" (")[0]).filter(Boolean);
}
export async function auditStage4JResources(root,{macPlatform=process.platform}={}){
 if(macPlatform!=="darwin")reject("NOT_MAC");
 await verifyReleaseResources(root,"darwin-arm64");
 const assets=resolve(root,"src-tauri","resources");
 const lockPath=resolve(root,"src-tauri","release-resources.lock.json");
 regularWithoutSymlink(lockPath);
 const lock=JSON.parse(readFileSync(lockPath,"utf8"));
 if(lock.target!=="darwin-arm64"||!lock.popplerDylibs||
    typeof lock.popplerDylibs!=="object"||
    Array.isArray(lock.popplerDylibs))reject("LIBRARY_LOCK_MISSING");
 const dir=join(assets,"poppler","libs");
 if(!existsSync(dir)||realpathSync(dir)!==dir)reject("LIBRARY_PATH");
 const names=readdirSync(dir).sort();
 const expected=Object.keys(lock.popplerDylibs).sort();
 if(expected.length<1||JSON.stringify(names)!==JSON.stringify(expected)||
    expected.some(n=>!/^[a-zA-Z0-9_+.-]+\.dylib$/.test(n)))
  reject("LIBRARY_INVENTORY_MISMATCH");
 const binaries=[join(assets,"poppler","pdftotext")];
 for(const name of names){
  const path=join(dir,name);
  regularWithoutSymlink(path);
  if(await digest(path)!==lock.popplerDylibs[name])reject("LIBRARY_SHA256_MISMATCH");
  binaries.push(path);
 }
 for(const binary of binaries){
  for(const dependency of macLibraryDependencies(binary)){
   if(dependency.startsWith("@loader_path/")){
    const next=resolve(dirname(binary),dependency.slice("@loader_path/".length));
    if(!next.startsWith(dir+sep)||!existsSync(next)||realpathSync(next)!==next)
      reject("NON_BUNDLED_LIBRARY_DEPENDENCY");
   } else if(!dependency.startsWith("/usr/lib/")&&
             !dependency.startsWith("/System/Library/")){
    reject("ABSOLUTE_OR_RPATH_LIBRARY_DEPENDENCY");
   }
  }
 }
 for(const name of ["poppler-COPYING","poppler-COPYING3","typst-LICENSE","typst-NOTICE"]){
  const path=join(assets,"licenses",name);
  regularWithoutSymlink(path);
  if(lstatSync(path).size<200)reject("LICENSE_MISSING_OR_EMPTY");
 }
 const stt=join(assets,"stt","KatoSyncSpeechHelper.app");
 const signed=spawnSync("codesign",["-dv","--verbose=2",stt],{
  encoding:"utf8",timeout:5000
 });
 if(signed.status!==0||!signed.stderr?.includes("TeamIdentifier=T8SB89JPX7"))
  reject("STT_TEAM_IDENTITY_UNVERIFIED");
 const proof=spawnSync("codesign",["--verify","--strict",stt],{
  encoding:"utf8",timeout:5000
 });
 if(proof.status!==0)reject("STT_CODE_SIGNATURE_INVALID");
 return Object.freeze({target:"darwin-arm64",
  popplerDylibCount:names.length,
  verifiedTopLevelResources:3,
  licenseFiles:4,
  preSignResourceLockSha256:await digest(lockPath),
  note:"Read-only resource preflight; signing and notarization NOT performed"});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
  const value=await auditStage4JResources(root);
  console.log("STAGE4J_LOCAL_RESOURCE_AUDIT_PASS",JSON.stringify(value));
 }catch(e){
  console.error(String(e?.message??"STAGE4J_BLOCKED"));
  process.exitCode=1;
 }
}
