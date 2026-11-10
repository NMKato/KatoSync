// NMKato Solutions — Stage4J owner-approved handoff contracts
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("../scripts/qa-stage4j-owner-approved-modelguard-handoff.sh",import.meta.url),"utf8");
test("handoff accepts only two known physical QA app pairs",()=>{
  assert.match(s,/case "\$mode" in/);
  assert.match(s,/M2\)/);
  assert.match(s,/M3\)/);
  assert.match(s,/STAGE4J_HANDOFF_DEVICE_DENIED/);
  assert.match(s,/codesign --verify --deep --strict/);
  assert.match(s,/TeamIdentifier=T8SB89JPX7/);
  assert.match(s,/spctl --assess --type execute/);
  assert.match(s,/d7cc147c2a0613957f3924ef3bd8c5b449168c975cf8bf3f82bbdb7605fb5a22/);
});
test("default preflight must not ask to quit or open app",()=>{
  assert.match(s,/action="--preflight"/);
  assert.match(s,/if test "\$action" = "--preflight"; then exit 0; fi/);
});
test("local work state and model reservation fail closed",()=>{
  assert.match(s,/for d in inbox running; do/);
  assert.match(s,/STAGE4J_HANDOFF_WORK_NOT_IDLE/);
  assert.match(s,/STAGE4J_HANDOFF_ACTIVE_LOCAL_MODEL/);
});
test("unsaved work requires explicit owner confirmation",()=>{
  assert.match(s,/Ungespeicherte Texte/);
  assert.match(s,/buttons \{"Abbrechen", "Alte Version beenden"\} default button "Abbrechen"/);
  assert.match(s,/giving up after 45/);
  assert.match(s,/STAGE4J_HANDOFF_OWNER_CANCELLED/);
});
test("exact old GUI menu quits before exactly one new process starts, without force killing",()=>{
  assert.match(s,/process_check old/);
  assert.match(s,/process_check none/);
  assert.match(s,/process_check new/);
  assert.match(s,/to tell process "katosync" to click menu item "Quit KatoSync 4J Single Instance Fixed QA"/);
  assert.match(s,/open -n "\$NEW"/);
  assert.doesNotMatch(s,/\b(killall|pkill|SIGKILL|SIGTERM)\b/);
});
