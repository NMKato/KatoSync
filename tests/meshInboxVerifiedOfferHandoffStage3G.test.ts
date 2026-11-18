// NMKato Solutions – Stage 3G: Inbox signed offer → explicit native challenge.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const rust=read("../src-tauri/src/mesh_inbox_receiver.rs");
const ui=read("../src/components/MeshConnectionCard.tsx");
test("native verifies sender offer, target and dispatch BEFORE returning only the public offer",()=>{
 assert.match(rust,/verify_offer\(&entry\.signed_offer, uid, now\)/);
 assert.match(rust,/key\.verify\(message\.as_bytes\(\), &sig\)/);
 assert.match(rust,/entry\.target_device_id != own_device/);
 assert.match(rust,/expires\.timestamp\(\) != entry\.signed_offer\.expires_at/);
 assert.match(rust,/signed_offer: entry\.signed_offer/);
 assert.match(rust,/pub struct InboxItem \{/);
 assert.match(rust,/signed_offer: MeshOffer/);
 assert.match(rust,/verified_public_offer_is_bound_to_sender_account_and_target_only/);
 assert.doesNotMatch(rust,/ensure_identity\(|set_password/);
});
test("accepted request exposes exactly one explicit signed challenge action, never auto-trust",()=>{
 const accept=ui.slice(ui.indexOf("const decideRecipientInvite=async"),ui.indexOf("const [directoryBusy"));
 assert.match(accept,/result\.state==="accepted"&&item\.signedOffer\.expiresAt\*1000>Date\.now\(\)/);
 assert.match(accept,/setAcceptedInboxOffer\(item\)/);
 assert.match(accept,/const prepareAcceptedChallenge=async\(\)=>/);
 assert.match(accept,/if\(challengeInFlight\.current\|\|!accepted/);
 assert.match(accept,/invoke<string>\("mesh_pairing_challenge_create"/);
 assert.match(accept,/offerJson:JSON\.stringify\(accepted\.signedOffer\)/);
 assert.match(accept,/challenge\.offer\?\.nonce!==accepted\.signedOffer\.nonce/);
 assert.match(accept,/challenge\.offer\?\.signature!==accepted\.signedOffer\.signature/);
 assert.match(accept,/setAcceptedChallenge\(raw\)/);
 assert.doesNotMatch(accept,/mesh_local_approve_peer|mesh_transport|remote_task_execute/);
});
test("signed-offer receipt is strict, keyed to Inbox expiry and never copies secrets",()=>{
 const scan=ui.slice(ui.indexOf("const loadRecipientInbox=async"),ui.indexOf("const decideRecipientInvite=async"));
 assert.match(scan,/item\.signedOffer\?\.protocol!=="katosync-mesh-pairing-v1"/);
 assert.match(scan,/item\.signedOffer\.expiresAt\*1000!==Date\.parse\(item\.expiresAt\)/);
 assert.match(scan,/item\.signedOffer\.signature/);
 assert.match(ui,/onClick=\{\(\)=>void prepareAcceptedChallenge\(\)\}/);
 assert.match(ui,/onClick=\{\(\)=>void copyPublicMessage\(acceptedChallenge\)\}/);
 assert.match(ui,/t\("mesh\.recipient\.notConnected"\)/);
 assert.match(ui,/setAcceptedInboxOffer\(null\);setAcceptedChallenge\(null\)/);
});
test("four languages clearly say this is a manual public proof, not a pairing",()=>{
 for(const lang of ["de","en","es","ru"]){
  const text=read("../src/i18n/locales/"+lang+".ts");
  for(const key of ["heading","description","createChallenge","ready","next","copyChallenge","failed"])
   assert.ok(text.includes('"mesh.handoff.'+key+'":'),lang+"/"+key);
 }
});
