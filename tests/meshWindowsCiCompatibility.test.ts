// NMKato Solutions: Windows checkout must preserve the exact reviewed SQL bytes.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {MIGRATIONS,verifyLocalContract} from "../scripts/qa-mesh-inbox-rollout-gate.mjs";
const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
test("all four reviewed inbox migrations retain byte-identical LF endings on Windows and macOS",()=>{
 const attrs=read("../.gitattributes");
 const lines=attrs.split(/\r?\n/).filter(x=>!x.startsWith("#")&&x.trim());
 for(const migration of MIGRATIONS.filter(x=>x.kind==="inbox")){
  const name="supabase/migrations/"+migration.version+"_"+migration.name+".sql";
  assert.ok(lines.includes(name+" text eol=lf"),"Missing immutable SQL LF rule: "+name);
  const data=read("../"+name);
  assert.ok(!data.includes("\r"),"Reviewed source contains CR (not LF): "+name);
 }
 assert.equal(verifyLocalContract().versions.length,7);
});
test("direct QA subprocess tests use platform-correct paths instead of URL pathname",()=>{
 const code=read("meshInboxEdgePostgresE2eContract.test.ts");
 const lan=read("meshTwoHostSignedInviteContract.test.ts");
 assert.match(code,/fileURLToPath\(new URL\("meshInboxEdgePostgresE2e.qa.ts"/);
 assert.match(lan,/spawnSync\(process.execPath,\[fileURLToPath\(script\)\]/);
 assert.match(lan,/process.platform==="win32"/);
 assert.doesNotMatch(code,/\.qa.ts",import\.meta\.url\)\.pathname/);
 assert.doesNotMatch(lan,/spawnSync\("bash",\[shell\.pathname\]/);
});
