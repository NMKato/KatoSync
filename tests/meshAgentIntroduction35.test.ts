import {test} from "node:test";
import assert from "node:assert/strict";
import {selectMeshColleague,prepareMeshWelcome} from "../src/lib/meshAgentIntroduction35.ts";
const owner="11111111-1111-4111-8111-111111111111";
const own="device-0001",peer="device-0002";
const colleague={
 deviceId:peer,ownerUserId:owner,displayName:"Mac",agentName:"KAI Nova",
 fingerprint:"AA-BB",membershipState:"discovered" as const,
 locallyPinned:false,peerProofVerified:false,secureTransportReady:false
};
test("same-account roster discovery does not silently grant trust",()=>{
 const x=selectMeshColleague({accountVerified:true,ownerUserId:owner,ownDeviceId:own,devices:[colleague]});
 assert.equal(x.stage,"discovered");
 assert.equal(x.canAutoSendHello,false);
 assert.equal(x.canReceiveBriefing,false);
});
test("a different account never becomes a colleague, including a trusted-looking entry",()=>{
 const x=selectMeshColleague({accountVerified:true,ownerUserId:owner,ownDeviceId:own,devices:[
  {...colleague,ownerUserId:"22222222-2222-4222-8222-222222222222",
   membershipState:"trusted",locallyPinned:true,peerProofVerified:true,secureTransportReady:true}
 ]});
 assert.equal(x.stage,"no_colleagues");
});
test("mutual trust, account scope and TLS unlock automatic hello, not remote writing",()=>{
 const x=selectMeshColleague({accountVerified:true,ownerUserId:owner,ownDeviceId:own,devices:[
  {...colleague,membershipState:"trusted",locallyPinned:true,peerProofVerified:true,secureTransportReady:true}
 ]});
 assert.equal(x.stage,"ready_for_hello");
 assert.equal(x.canAutoSendHello,true);
});
test("a smalltalk warm-up only shares explicitly approved bounded summaries",()=>{
 const data=prepareMeshWelcome({senderDeviceId:own,recipientDeviceId:peer,agentName:"KAI Atlas",
  peerAgentName:"KAI Nova",nowMs:100000,peerWasMutuallyAuthorized:true,
  ownerScopeVerified:true,privateTransportReady:true,introductionAlreadyConfirmed:false,work:[
   {projectLabel:"GenXline",completedJobs:17,currentRole:"coding",shareApproved:true},
   {projectLabel:"/Users/private/.ssh/id_rsa",completedJobs:1,currentRole:"review",shareApproved:true},
   {projectLabel:"KatoSync",completedJobs:5,currentRole:"review",shareApproved:false},
   {projectLabel:"KatoOS",completedJobs:10,currentRole:"support",shareApproved:true}
  ]});
 assert.ok(data);
 assert.equal(data?.sharedWork.length,2);
 assert.ok(JSON.stringify(data).includes("GenXline"));
 assert.ok(!JSON.stringify(data).includes("id_rsa"));
 assert.ok(!JSON.stringify(data).includes('"KatoSync"'));
 assert.equal(data?.pairingGrant,false);
 assert.equal(data?.remoteJobGrant,false);
});
test("a welcome without trusted transport or verified account is not created",()=>{
 const baseline={senderDeviceId:own,recipientDeviceId:peer,agentName:"KAI Atlas",
   peerAgentName:"KAI Nova",nowMs:1000,peerWasMutuallyAuthorized:true,
   ownerScopeVerified:true,privateTransportReady:true,introductionAlreadyConfirmed:false,work:[]};
 for(const patch of [
  {peerWasMutuallyAuthorized:false},{ownerScopeVerified:false},
  {privateTransportReady:false},{introductionAlreadyConfirmed:true},{recipientDeviceId:own},
 ]){
  assert.equal(prepareMeshWelcome({...baseline,...patch}),null);
 }
});
