// NMKato Solutions — Stage 3.5 trusted onboarding policy evaluator.
// This PURE state machine does not create network connections or approval grants.
// Same account is necessary but NEVER sufficient to grant remote execution.
export interface AutoJoinEvidence {
  ownerSessionVerified: boolean;
  sameAccountServerVerified: boolean;
  proEntitlementActive: boolean;
  autoJoinConsentOnBothDevices: boolean;
  currentDeviceEnrolled: boolean;
  remoteDeviceEnrolled: boolean;
  remoteDeviceNotRevoked: boolean;
  quotaWithinLimit: boolean;
  signedPublicOfferValid: boolean;
  challengeWithinLifetime: boolean;
  replayNonceUnused: boolean;
  ownerPasskeyAdmissionVerified: boolean;
  mutualPossessionProofValid: boolean;
  localKeychainPeerPinMatches: boolean;
  peerTlsCertificateVerified: boolean;
}
export type AutoJoinStage =
  | "not_eligible"
  | "signed_introduction_permitted"
  | "awaiting_owner_proof"
  | "mutual_trust_ready";

export interface AutoJoinDecision {
  stage:AutoJoinStage;
  maySendSignedIntroduction:boolean;
  mayConnectAuthenticatedTransport:boolean;
  mayExchangeApprovedWorkSummaries:boolean;
  mayRunRemoteJobs:boolean;
}
export function evaluateMeshAutoJoin(e:AutoJoinEvidence):AutoJoinDecision {
  const denied=(stage:AutoJoinStage):AutoJoinDecision=>({
    stage,maySendSignedIntroduction:false,mayConnectAuthenticatedTransport:false,
    mayExchangeApprovedWorkSummaries:false,mayRunRemoteJobs:false
  });
  if(!e.ownerSessionVerified||!e.sameAccountServerVerified||
     !e.proEntitlementActive||!e.autoJoinConsentOnBothDevices||
     !e.currentDeviceEnrolled||!e.remoteDeviceEnrolled||
     !e.remoteDeviceNotRevoked||!e.quotaWithinLimit||
     !e.signedPublicOfferValid||!e.challengeWithinLifetime||!e.replayNonceUnused){
    return denied("not_eligible");
  }
  if(!e.ownerPasskeyAdmissionVerified){
    return {...denied("signed_introduction_permitted"),maySendSignedIntroduction:true};
  }
  if(!e.mutualPossessionProofValid||!e.localKeychainPeerPinMatches||
     !e.peerTlsCertificateVerified){
    return {...denied("awaiting_owner_proof"),maySendSignedIntroduction:true};
  }
  return {
    stage:"mutual_trust_ready",
    maySendSignedIntroduction:true,mayConnectAuthenticatedTransport:true,
    mayExchangeApprovedWorkSummaries:true,
    // Verified TLS alone is still not a signed, approved job authorization.
    mayRunRemoteJobs:false
  };
}
