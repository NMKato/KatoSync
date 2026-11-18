// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import {
 validEasyMeshSession,matchEasyRelayMessage,canQuickApproveSameCode,
 type EasyMeshSession,type EasyRelayMessage
} from "../src/lib/meshEasyPairing.ts";
const now=Date.UTC(2026,10,11,14,0);
const a="11111111-1111-4111-8111-111111111111";
const b="22222222-2222-4222-8222-222222222222";
const requestId="33333333-3333-4333-8333-333333333333";
const fp="AA-BB-CC-DD-EE-FF-00-11-22-33-44-55-66-77-88-99";
const session:EasyMeshSession={role:"sender",requestId,localDeviceId:a,peerDeviceId:b,
 peerFingerprint:fp,expiresAtMs:now+240000};
const msg:EasyRelayMessage={requestId,senderDeviceId:b,recipientDeviceId:a,
 kind:"challenge",expiresAt:Math.floor((now+240000)/1000)};
test("only live account-bound exchange maps onto correct peer and request",()=>{
 assert.ok(validEasyMeshSession(session,now));
 assert.ok(matchEasyRelayMessage(session,msg,now));
 assert.equal(matchEasyRelayMessage(session,{...msg,kind:"response"},now),false);
 assert.equal(matchEasyRelayMessage(session,{...msg,requestId:a},now),false);
 assert.equal(matchEasyRelayMessage(session,{...msg,senderDeviceId:a},now),false);
 assert.equal(matchEasyRelayMessage(session,{...msg,recipientDeviceId:b},now),false);
 assert.equal(matchEasyRelayMessage(session,{...msg,expiresAt:Math.floor((now+600000)/1000)},now),false);
 assert.equal(matchEasyRelayMessage(session,msg,now+240001),false);
 assert.equal(matchEasyRelayMessage(session,msg,now-700000),false);
 assert.equal(matchEasyRelayMessage({...session,localDeviceId:b},msg,now),false);
 assert.ok(matchEasyRelayMessage({...session,role:"recipient",localDeviceId:b,peerDeviceId:a},
   {...msg,kind:"response",senderDeviceId:a,recipientDeviceId:b},now));
});
test("never silently pin: direct owner acknowledgment and exact signed identity required",()=>{
 const proof={comparisonCode:"A1B2-C3D4-E5F6",fingerprint:fp,paired:false as const,peerCount:0 as const,transportReady:false as const};
 const peer={fingerprint:fp,membershipState:"discovered" as const};
 const args={proof,peer,session,explicitOwnerConfirmation:true,busy:false,nowMs:now};
 assert.ok(canQuickApproveSameCode(args));
 assert.equal(canQuickApproveSameCode({...args,explicitOwnerConfirmation:false}),false);
 assert.equal(canQuickApproveSameCode({...args,busy:true}),false);
 assert.equal(canQuickApproveSameCode({...args,peer:{...peer,fingerprint:fp.replace("AA","AB")}}),false);
 assert.equal(canQuickApproveSameCode({...args,peer:{...peer,membershipState:"revoked"}}),false);
 assert.equal(canQuickApproveSameCode({...args,proof:{...proof,comparisonCode:"garbage"}}),false);
 assert.equal(canQuickApproveSameCode({...args,nowMs:now+240001}),false);
 assert.equal(canQuickApproveSameCode({...args,session:null}),false);
});
