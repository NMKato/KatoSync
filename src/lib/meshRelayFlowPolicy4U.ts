// Created by NMKato Solutions — Stage4U: signed Mesh QA relay read budget and fail-closed scheduling.
// PostgreSQL trigger permits at most 12 signed reads per device per rolling minute.
// 12s + one initial read <= 6/min, leaving headroom for manual checks and timing jitter.
export const EASY_RELAY_POLL_MS = 12_000;
export type EasyRelayPollingStage = "idle"|"waiting"|"verifying"|"compare"|"approved"|"expired"|"error";
export interface EasyRelayPollInput {
  sessionValid:boolean;
  stage:EasyRelayPollingStage;
  hasProof:boolean;
  hasOutboundWork:boolean;
  hasAcceptedOffer:boolean;
  failed:boolean;
}
/** A signed outbound message has priority over background status reads. */
export function canPollEasyMeshRelay(input:EasyRelayPollInput):boolean {
  return input.sessionValid && !input.hasProof && !input.hasOutboundWork &&
    !input.hasAcceptedOffer && !input.failed &&
    (input.stage==="waiting"||input.stage==="verifying");
}
