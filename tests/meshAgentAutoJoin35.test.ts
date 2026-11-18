import {test} from "node:test";
import assert from "node:assert/strict";
import {evaluateMeshAutoJoin,type AutoJoinEvidence} from "../src/lib/meshAgentAutoJoin35.ts";
const proof:AutoJoinEvidence={
 ownerSessionVerified:true,sameAccountServerVerified:true,
 proEntitlementActive:true,autoJoinConsentOnBothDevices:true,
 currentDeviceEnrolled:true,remoteDeviceEnrolled:true,remoteDeviceNotRevoked:true,
 quotaWithinLimit:true,signedPublicOfferValid:true,challengeWithinLifetime:true,
 replayNonceUnused:true,ownerPasskeyAdmissionVerified:true,
 mutualPossessionProofValid:true,localKeychainPeerPinMatches:true,
 peerTlsCertificateVerified:true
};
test("same account and local opt-in can begin a signed public introduction",()=>{
 const next=evaluateMeshAutoJoin({...proof,ownerPasskeyAdmissionVerified:false});
 assert.equal(next.stage,"signed_introduction_permitted");
 assert.equal(next.maySendSignedIntroduction,true);
 assert.equal(next.mayConnectAuthenticatedTransport,false);
 assert.equal(next.mayExchangeApprovedWorkSummaries,false);
});
test("automatic trusted transport needs both device proofs and certificate pins",()=>{
 const next=evaluateMeshAutoJoin(proof);
 assert.equal(next.stage,"mutual_trust_ready");
 assert.equal(next.mayConnectAuthenticatedTransport,true);
 assert.equal(next.mayExchangeApprovedWorkSummaries,true);
 assert.equal(next.mayRunRemoteJobs,false);
});
test("revoked, expired, unregistered, different account or unsubscribed peers cannot auto-join",()=>{
 const failFields:Array<keyof AutoJoinEvidence>=[
 "ownerSessionVerified","sameAccountServerVerified","proEntitlementActive",
 "autoJoinConsentOnBothDevices","currentDeviceEnrolled",
 "remoteDeviceEnrolled","remoteDeviceNotRevoked","quotaWithinLimit",
 "signedPublicOfferValid","challengeWithinLifetime","replayNonceUnused"
 ];
 for(const name of failFields){
  const result=evaluateMeshAutoJoin({...proof,[name]:false});
  assert.equal(result.stage,"not_eligible",name);
  assert.equal(result.maySendSignedIntroduction,false,name);
  assert.equal(result.mayConnectAuthenticatedTransport,false,name);
 }
});
test("a missing fresh proof, Keychain pin or TLS authentication never permits warm-up",()=>{
 for(const name of ["mutualPossessionProofValid","localKeychainPeerPinMatches",
                    "peerTlsCertificateVerified"] as const){
  const result=evaluateMeshAutoJoin({...proof,[name]:false});
  assert.equal(result.stage,"awaiting_owner_proof",name);
  assert.equal(result.mayExchangeApprovedWorkSummaries,false,name);
  assert.equal(result.mayRunRemoteJobs,false,name);
 }
});
