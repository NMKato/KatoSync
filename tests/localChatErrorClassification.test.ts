import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyLocalChatFailure} from "../src/lib/localChatError.ts";

test("offline Gemma does not trigger unnecessary history migration or reload",()=>{
 for(const err of ["CHAT_MODEL_NOT_READY","CHAT_IMAGE_MODEL_NOT_READY",
  "Gemma lokal nicht bereit; kein Cloud-Fallback."]){
  assert.deepEqual(classifyLocalChatFailure(err),{
   key:"continuity.chat.modelUnavailable",reload:false
  });
 }
});
test("stale chat sequence or Git identity require explicit reload, never blind replay",()=>{
 assert.deepEqual(classifyLocalChatFailure("Chat-Historie hat sich verändert; bitte neu laden."),{
  key:"continuity.chat.historyChanged",reload:true
 });
 assert.deepEqual(classifyLocalChatFailure("Git-HEAD hat sich geändert; Antwort nicht gespeichert."),{
  key:"continuity.chat.projectChanged",reload:true
 });
});
test("unknown errors never expose sensitive backend details",()=>{
 const result=classifyLocalChatFailure("token=private /Users/secret/.ssh/id_ed25519");
 assert.deepEqual(result,{key:"continuity.chat.saveError",reload:true});
});
test("React UI restores draft and keeps loaded history on model unavailability",()=>{
 const ui=readFileSync(new URL("../src/components/ContinuityLocalChatPanel.tsx",import.meta.url),"utf8");
 const native=readFileSync(new URL("../src-tauri/src/memory_fabric/continuity_bridge.rs",import.meta.url),"utf8");
 assert.match(ui,/classifyLocalChatFailure\(cause\)/);
 assert.match(ui,/if\(failure\.reload\)setLoaded\(false\)/);
 assert.match(ui,/setQuestion\(existing=>existing\|\|text\)/);
 assert.match(native,/CHAT_MODEL_NOT_READY/);
 assert.match(native,/CHAT_IMAGE_MODEL_NOT_READY/);
});
