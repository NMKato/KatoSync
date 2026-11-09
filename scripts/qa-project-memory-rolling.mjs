// NMKato Solutions — Project Memory rolling STATUS projection QA v1.
// Deterministic, read-only function of existing canonical journal events.
// NO filesystem write, no remote connection, no privilege grant, no merge.
// Source truth remains the existing project-scoped SQLite continuity journal.
import {createHash} from "node:crypto";

export const SCHEMA="katosync.status-flow-projection/v1";
export const MAX_EVENT_COUNT=5000;
const HEX64=/^[0-9a-f]{64}$/;
const SAFE_ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const SHA=/^[0-9a-f]{40,64}$/;
const KINDS=new Set(["checkpoint","decision_proposal","work_note","handoff","test_result","agent_note","commit","job_event"]);
const SAFE_URL=/\b(?:https?:\/\/[^\s]+|postgres(?:ql)?:\/\/[^\s]+)\b/i;
const SECRET=/\b(?:sb_secret_[a-zA-Z0-9_-]+|github_pat_[a-zA-Z0-9_-]+|ghp_[a-zA-Z0-9_-]+|sk-[a-zA-Z0-9_-]{16,}|Bearer\s+\S+|SUPABASE_SERVICE_ROLE_KEY\s*=|PRIVATE_KEY\s*=)\b/i;

function sha(value){return createHash("sha256").update(value,"utf8").digest("hex");}
function reject(code){throw Error("STATUS_FLOW_QA_"+code);}
function own(o,k){return Object.prototype.hasOwnProperty.call(o,k);}
function id(s){return typeof s==="string"&&SAFE_ID.test(s);}
function text(s,max){
 if(typeof s!=="string"||s.length>max||s.length===0||SAFE_URL.test(s)||SECRET.test(s))
  reject("UNSAFE_OR_OVERSIZE_TEXT");
 // Treat incoming Markdown, HTML and prompt instructions as untrusted display data.
 return s.normalize("NFC").replace(/[\r\n\t]+/g," ")
  .replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/\\/g,"\\\\").replace(/([*_[\]`])/g,"\\$1").trim();
}
function headInput(input){
 if(!input||typeof input!=="object"||Array.isArray(input)||!id(input.projectId))
  reject("PROJECT_ID");
 if(!Array.isArray(input.events)||input.events.length>MAX_EVENT_COUNT)
  reject("EVENTS_BOUNDED");
 if(!input.checkpoint||typeof input.checkpoint!=="object"||
    !Number.isSafeInteger(input.checkpoint.sequence)||input.checkpoint.sequence<0||
    !SHA.test(input.checkpoint.commitSha||"")||
    typeof input.checkpoint.summary!=="string")
  reject("CHECKPOINT_REQUIRED");
 const checkpoint={
  sequence:input.checkpoint.sequence,
  commitSha:input.checkpoint.commitSha,
  summary:text(input.checkpoint.summary,1000),
  verification:"supplied-candidate-not-independently-verified"
 };
 const maxActiveEvents=input.maxActiveEvents??500;
 const maxActiveBytes=input.maxActiveBytes??256*1024;
 if(!Number.isSafeInteger(maxActiveEvents)||maxActiveEvents<2||maxActiveEvents>1000||
    !Number.isSafeInteger(maxActiveBytes)||maxActiveBytes<1024||maxActiveBytes>512*1024)
  reject("ROTATION_LIMITS");
 return {checkpoint,maxActiveEvents,maxActiveBytes};
}
function normalize(input){
 const ids=new Set();
 let last=0;
 const projected=[];
 for(const e of input.events){
  if(!e||typeof e!=="object"||Array.isArray(e)||
     e.projectId!==input.projectId||!id(e.eventId)||!id(e.agentId)||
     !KINDS.has(e.kind)||!Number.isSafeInteger(e.sequence)||
     e.sequence!==last+1||ids.has(e.eventId)||
     typeof e.createdAt!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(e.createdAt)||
     !Number.isFinite(Date.parse(e.createdAt))||
     (e.commitSha!=null&&!SHA.test(e.commitSha))||
     (e.taskId!=null&&!id(e.taskId))||
     (e.targetAgent!=null&&!id(e.targetAgent)))
   reject("UNTRUSTED_EVENT_OR_FORK");
  const item={
   projectId:e.projectId,eventId:e.eventId,sequence:e.sequence,
   agentId:e.agentId,taskId:e.taskId??null,targetAgent:e.targetAgent??null,
   kind:e.kind,createdAt:e.createdAt,commitSha:e.commitSha??null,
   summary:text(e.summary,1200)
  };
  projected.push(item);
  ids.add(e.eventId);
  last=e.sequence;
 }
 return projected;
}
function row(e){
 const bits=[`#${e.sequence}`,e.kind,`by:${e.agentId}`];
 if(e.taskId)bits.push(`task:${e.taskId}`);
 if(e.commitSha)bits.push(`commit:${e.commitSha.slice(0,12)}`);
 if(e.targetAgent)bits.push(`to:${e.targetAgent}`);
 return `- ${bits.join(" | ")} | ${e.summary}\n`;
}
function archiveBody(projectId,batch,prevDigest,index){
 const heading=`# STATUS ARCHIVE ${String(index).padStart(6,"0")}\n\n`;
 const meta=`Project: ${projectId}\nEvents: ${batch[0].sequence}..${batch.at(-1).sequence}\nPrevious archive SHA-256: ${prevDigest||"GENESIS"}\n\n`;
 return heading+meta+batch.map(row).join("");
}
function checkpointLine(checkpoint){
 return `Checkpoint #${checkpoint.sequence} @ ${checkpoint.commitSha.slice(0,12)}: ${checkpoint.summary}\n`;
}
function currentBody(projectId,events,checkpoint,archives){
 const ref=archives.at(-1);
 const a=ref?`Previous archive: [${ref.path}](${ref.path}) (SHA-256: ${ref.digest})\n`:"Previous archive: none\n";
 return `# PROJECT_STATUS_FLOW.md\n\nProject: ${projectId}\nSchema: ${SCHEMA}\n`+
  `Status: QA projection only — no autonomous writes or authoritative grants\n`+
  checkpointLine(checkpoint)+a+`\n## Recent project events\n\n`+(events.length?events.map(row).join(""):"_(none)_\n");
}
function archivePath(i){return `.katosync/archive/status-flow/${String(i).padStart(6,"0")}.md`;}
function pushArchive(archives,batch,projectId){
 const idx=archives.length+1;
 const prev=archives.at(-1)?.digest??null;
 const body=archiveBody(projectId,batch,prev,idx);
 const digest=sha(body);
 archives.push(Object.freeze({index:idx,path:archivePath(idx),firstSequence:batch[0].sequence,
  lastSequence:batch.at(-1).sequence,previousDigest:prev,digest,content:body,
  eventIds:batch.map(e=>e.eventId)}));
}
export function buildRollingStatusProjection(input){
 const {checkpoint,maxActiveEvents,maxActiveBytes}=headInput(input);
 const events=normalize(input);
 if(checkpoint.sequence>events.length)reject("CHECKPOINT_OUTSIDE_JOURNAL");
 const archives=[],active=[];
 for(const e of events){
  active.push(e);
  // We always leave at least one recent event in the active projection.
  const body=currentBody(input.projectId,active,checkpoint,archives);
  if(active.length>maxActiveEvents||Buffer.byteLength(body,"utf8")>maxActiveBytes){
   if(active.length>1){
    pushArchive(archives,active.splice(0,active.length-1),input.projectId);
   }else{
    reject("SINGLE_EVENT_EXCEEDS_LIMIT");
   }
  }
 }
 const current=currentBody(input.projectId,active,checkpoint,archives);
 if(Buffer.byteLength(current,"utf8")>maxActiveBytes)
  reject("SUMMARY_TOO_LARGE");
 const rows=events.map(e=>{
  const archive=archives.find(a=>e.sequence>=a.firstSequence&&e.sequence<=a.lastSequence);
  return Object.freeze({projectId:e.projectId,eventId:e.eventId,sequence:e.sequence,
   kind:e.kind,agentId:e.agentId,taskId:e.taskId,targetAgent:e.targetAgent,
   commitSha:e.commitSha,summary:e.summary,archivePath:archive?.path??null});
 });
 return Object.freeze({
  schema:SCHEMA,projectId:input.projectId,
  currentMarkdown:current,checkpoint,archives:Object.freeze(archives),
  index:Object.freeze(rows),latestSequence:events.length,
  automaticMergeAllowed:false,remoteJobsEnabled:false,writerAuthorized:false,
  // No real permission, signatures, session or branch verification here.
  authoritative:false,requiresCanonicalJournalAndLeaseValidation:true
 });
}
export function verifyProjectionIntegrity(projection){
 // This verifies internal consistency of a derived view; it does not
 // authenticate canonical journal origins or prove a signing key.
 if(!projection||projection.schema!==SCHEMA||!id(projection.projectId)||
    !Array.isArray(projection.archives)||!Array.isArray(projection.index)||
    !projection.checkpoint||!Number.isSafeInteger(projection.latestSequence)||
    projection.latestSequence!==projection.index.length)return false;
 let prior=null,lastArchiveIndex=0,lastSequence=0;
 for(const a of projection.archives){
  if(!a||a.previousDigest!==prior||a.digest!==sha(a.content)||
     a.index!==lastArchiveIndex+1||a.path!==archivePath(a.index)||
     a.firstSequence!==lastSequence+1||
     !Number.isSafeInteger(a.lastSequence)||a.firstSequence>a.lastSequence)return false;
  const covered=projection.index.slice(a.firstSequence-1,a.lastSequence);
  if(covered.length!==a.lastSequence-a.firstSequence+1||
     covered.some(e=>e.archivePath!==a.path)||
     JSON.stringify(covered.map(e=>e.eventId))!==JSON.stringify(a.eventIds)||
     archiveBody(projection.projectId,covered,prior,a.index)!==a.content)return false;
  prior=a.digest;lastArchiveIndex=a.index;lastSequence=a.lastSequence;
 }
 const recent=projection.index.slice(lastSequence);
 if(recent.some(e=>e.archivePath!==null))return false;
 for(let i=0;i<projection.index.length;i++){
  const e=projection.index[i];
  if(!e||e.projectId!==projection.projectId||e.sequence!==i+1||
     !id(e.eventId)||!id(e.agentId))return false;
 }
 return currentBody(projection.projectId,recent,projection.checkpoint,
   projection.archives)===projection.currentMarkdown;
}
export function queryStatusProjection(projection,{projectId,query,agentId,limit=20}){
 if(!projection||projectId!==projection.projectId||typeof query!=="string"||
  query.length<2||query.length>100||!Number.isSafeInteger(limit)||limit<1||limit>100)
  reject("SEARCH_SCOPE");
 if(agentId!=null&&!id(agentId))reject("AGENT_ID");
 const needle=query.toLowerCase();
 return projection.index.filter(x=>(agentId==null||x.agentId===agentId)&&
  [x.summary,x.agentId,x.taskId,x.commitSha,x.kind].some(s=>s?.toLowerCase().includes(needle)))
  .slice(-limit).reverse();
}
export function readAgentMailbox(projection,{projectId,agentId,afterSequence=0,limit=30}){
 if(!projection||projectId!==projection.projectId||!id(agentId)||
    !Number.isSafeInteger(afterSequence)||afterSequence<0||
    !Number.isSafeInteger(limit)||limit<1||limit>100)
  reject("MAILBOX_SCOPE");
 return projection.index.filter(e=>e.sequence>afterSequence&&
  (e.kind==="agent_note"||e.kind==="handoff")&&
  (e.targetAgent===agentId||e.targetAgent===null))
  .slice(-limit);
}
