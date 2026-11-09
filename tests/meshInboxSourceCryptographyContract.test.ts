// NMKato Solutions: independent regression contract for source verification.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sender=readFileSync(new URL("../supabase/functions/mesh-inbox-send/send.ts",import.meta.url),"utf8");
const recipient=readFileSync(new URL("../supabase/functions/mesh-inbox-receive/receive.ts",import.meta.url),"utf8");
test("inbox read reuses sender's original validated signature and recipient-bound dispatch",()=>{
 assert.match(sender,/export async function verifyStoredSignedMeshInvite/);
 assert.match(sender,/await verified\(parsed,owner\)/);
 assert.match(sender,/crypto\.subtle\.verify\("Ed25519",key,sig,enc\.encode\(payload\)\)/);
 assert.match(sender,/crypto\.subtle\.verify\("Ed25519",key,recipientSig,enc\.encode\(delivery\)\)/);
 assert.match(recipient,/verifyStoredSignedMeshInvite/);
 assert.match(recipient,/sourceKeys\.get\(invitation\.source_device_id\)!==signedOffer\.publicKey/);
 assert.match(recipient,/source\.revoked_at!==null/);
 assert.match(recipient,/source\.owner_user_id!==owner/);
 assert.match(recipient,/INBOX_SOURCE_UNVERIFIED/);
 assert.match(recipient,/sourceIds\.length\+1/);
 assert.doesNotMatch(recipient,/paired:true|remoteJobsEnabled:true|transportReady:true/);
});
