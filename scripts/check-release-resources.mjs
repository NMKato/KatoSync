// NMKato Solutions – explicit release-only resource integrity gate.
// MARK: QA builds may use .test-only files; production releases MUST NOT.
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {readFileSync,realpathSync,lstatSync,existsSync,readdirSync,openSync,readSync,closeSync} from "node:fs";
import {dirname,join,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const target=()=>`${process.platform}-${process.arch}`;
const namesByTarget={
  "darwin-arm64":["poppler/pdftotext","typst/typst","stt/KatoSyncSpeechHelper.app/Contents/MacOS/katosync-stt"],
  "darwin-x64":["poppler/pdftotext","typst/typst","stt/KatoSyncSpeechHelper.app/Contents/MacOS/katosync-stt"],
  "win32-x64":["poppler/pdftotext.exe","typst/typst.exe"]
};
function reject(message){throw new Error(message);}
function markerScan(dir){
  if(!existsSync(dir))reject("RELEASE_RESOURCE_DIRECTORY_MISSING");
  for(const item of readdirSync(dir,{withFileTypes:true})){
    if(item.name===".test-only")reject("RELEASE_QA_SENTINEL_FORBIDDEN");
    if(item.isDirectory())markerScan(join(dir,item.name));
    if(item.isSymbolicLink())reject("RELEASE_RESOURCE_SYMLINK_FORBIDDEN");
  }
}
async function hashFile(file){
  const digest=createHash("sha256");
  for await (const chunk of createReadStream(file))digest.update(chunk);
  return digest.digest("hex");
}
function checkBinaryMagic(path,isWindows){
  const file=openSync(path,"r");
  try{
    const head=Buffer.alloc(4);
    if(readSync(file,head,0,head.length,0)!==4)reject("RELEASE_BINARY_TOO_SHORT");
    if(isWindows){
      if(head[0]!==0x4d||head[1]!==0x5a)reject("RELEASE_NOT_PE");
    }else{
      const magic=head.toString("hex").toLowerCase();
      if(!["feedface","cefaedfe","feedfacf","cffaedfe","cafebabe","bebafeca","cafebabf","bfbafeca"].includes(magic))
        reject("RELEASE_NOT_MACHO");
    }
  }finally{closeSync(file);}
}
export async function verifyReleaseResources(projectRoot,platformTarget=target()){
  const expected=namesByTarget[platformTarget];
  if(!expected)reject("RELEASE_UNSUPPORTED_TARGET");
  const resources=resolve(projectRoot,"src-tauri","resources");
  const root=realpathSync(resources);
  const lockPath=resolve(projectRoot,"src-tauri","release-resources.lock.json");
  if(!existsSync(lockPath))reject("RELEASE_LOCK_MISSING");
  let lock;
  try{lock=JSON.parse(readFileSync(lockPath,"utf8"));}
  catch{reject("RELEASE_LOCK_INVALID");}
  if(lock.schemaVersion!==1||lock.target!==platformTarget||typeof lock.files!=="object"||!lock.files)
    reject("RELEASE_LOCK_TARGET_OR_SCHEMA_INVALID");
  if(platformTarget==="win32-x64"&&lock.features?.offlineDictation!==false)
    reject("RELEASE_WINDOWS_STT_MUST_BE_EXPLICITLY_DISABLED");
  for(const group of ["poppler","typst","stt"])markerScan(join(root,group));
  for(const name of expected){
    const digest=lock.files[name];
    if(typeof digest!=="string"||!/^[a-f0-9]{64}$/.test(digest))reject("RELEASE_HASH_NOT_LOCKED");
    const file=resolve(root,name);
    if(!file.startsWith(root+sep))reject("RELEASE_PATH_TRAVERSAL");
    let stat;
    try{stat=lstatSync(file);}catch{reject("RELEASE_REQUIRED_BINARY_MISSING");}
    if(!stat.isFile()||stat.size<4)reject("RELEASE_REQUIRED_BINARY_INVALID");
    if(realpathSync(file)!==file)reject("RELEASE_BINARY_SYMLINK_FORBIDDEN");
    if(platformTarget.startsWith("darwin")&&process.platform==="darwin"&&(stat.mode&0o111)===0)
      reject("RELEASE_BINARY_NOT_EXECUTABLE");
    checkBinaryMagic(file,platformTarget.startsWith("win32"));
    if(await hashFile(file)!==digest)reject("RELEASE_SHA256_MISMATCH");
  }
  // The SHA lock is an integrity gate, NOT a substitute for manual license
  // approval, platform smoke tests, code-signing or notarization.
  return {target:platformTarget,verified:expected.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=await verifyReleaseResources(resolve(here,".."));
    console.log(`RELEASE_RESOURCES_VERIFIED ${result.target} ${result.verified}`);
  }catch(error){
    console.error(`RELEASE_BLOCKED: ${error.message}`);
    process.exitCode=1;
  }
}
