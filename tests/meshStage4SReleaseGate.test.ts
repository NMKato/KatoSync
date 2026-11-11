// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("../scripts/build-stage4s-easy-mesh-qa-macos.sh",import.meta.url),"utf8");
test("only pinned isolated owner QA uses simplified pairing and signed heartbeat",()=>{
 for(const text of ["KATOSYNC_STAGE4S_OWNER_QA_ONLY",
    "KATOSYNC_STAGE4S_EXPECT_SOURCE_SHA","STAGE4S_SOURCE_SHA_DRIFT",
    "VITE_MESH_EASY_PAIR_QA=1","VITE_STAGE35_HEARTBEAT_QA=1",
    "VITE_STAGE35_AUTO_RESUME_QA=0",
    "KATOSYNC_MESH_INBOX_SEND_QA=1","KATOSYNC_MESH_INBOX_RECEIVE_QA=1",
    "KATOSYNC_MESH_PAIRING_RELAY_QA=1","--features stage4j-qa",
    "STAGE4S_COMPILED_NATIVE_QA_ENDPOINTS_PASS"])assert.ok(s.includes(text),text);
 assert.doesNotMatch(s,/supabase db push|supabase functions deploy|launchctl bootstrap|open -n|git push/);
});
