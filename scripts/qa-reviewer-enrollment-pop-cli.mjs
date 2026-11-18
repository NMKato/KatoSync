#!/usr/bin/env node
// Read-only offline QA ceremony. This NEVER signs, enrolls or authorizes anyone.
// The private reviewer key stays on the reviewer's separate device.
import {readSync} from "node:fs";
import {prepareReviewerPoP,verifyReviewerPoP} from "./qa-reviewer-enrollment-pop.mjs";
const FLAGS=["--reviewer-uid","--owner-uid","--project-id","--reviewer-public-key"];
function fromStdin(){
  const chunks=[];let n=0;
  for(;;){
    const b=Buffer.alloc(1024);
    const size=readSync(0,b,0,b.length,null);
    if(size===0)break;
    n+=size;if(n>4096)throw Error("POP_INPUT_TOO_LARGE");
    chunks.push(b.subarray(0,size));
  }
  return Buffer.concat(chunks).toString("utf8");
}
function exactProof(x){
  if(!x||typeof x!=="object"||Array.isArray(x)||
    Object.keys(x).length!==2||
    !Object.keys(x).every(k=>["challenge","signature"].includes(k)))
    throw Error("POP_INPUT_INVALID");
  return x;
}
function run(){
  const [mode,...args]=process.argv.slice(2);
  if(mode==="prepare"){
    if(args.length!==8)throw Error("POP_ARGUMENTS_INVALID");
    const seen=new Map();
    for(let i=0;i<8;i+=2){
      if(!FLAGS.includes(args[i])||seen.has(args[i])||!args[i+1]||
        args[i+1].startsWith("--"))throw Error("POP_ARGUMENTS_INVALID");
      seen.set(args[i],args[i+1]);
    }
    if(seen.size!==4)throw Error("POP_ARGUMENTS_INVALID");
    console.log(JSON.stringify(prepareReviewerPoP({
      reviewerUid:seen.get("--reviewer-uid"),ownerUid:seen.get("--owner-uid"),
      projectId:seen.get("--project-id"),
      reviewerPublicKey:seen.get("--reviewer-public-key")
    }),null,2));return;
  }
  if(mode==="verify"){
    if(args.length!==0)throw Error("POP_ARGUMENTS_INVALID");
    const input=exactProof(JSON.parse(fromStdin()));
    console.log(JSON.stringify(verifyReviewerPoP(input.challenge,input.signature),null,2));
    return;
  }
  throw Error("POP_USAGE_PREPARE_OR_VERIFY");
}
try{run();}catch(error){
  const known=String(error?.message??"");
  const code=/^POP_[A-Z_]+$/.test(known)?known:"POP_UNAVAILABLE";
  console.error(code);process.exitCode=1;
}
