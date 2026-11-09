// NMKato Solutions: local model fallback is on-device only.
// Returns a recommendation. It NEVER starts a runner, shares credentials or bypasses approval.
export type AgentProvider = "codex"|"claude"|"local_gemma";
export type AgentProviderAvailability = {
  ready: boolean;
  quotaAvailable: boolean;
  concurrencyAvailable: boolean;
};
export interface GemmaFallbackReadiness {
  modelLoaded: boolean;
  enoughFreeMemory: boolean;
  supportsTask: boolean;
  concurrencyAvailable: boolean;
}
export interface ProviderFallbackInput {
  approved: boolean;
  taskCanRunLocally: boolean;
  preference: readonly ("codex"|"claude")[];
  codex: AgentProviderAvailability;
  claude: AgentProviderAvailability;
  gemma: GemmaFallbackReadiness;
}
export type ProviderFallbackDecision =
  | {mode:"run";provider:AgentProvider;slowerLocalFallback:boolean}
  | {mode:"queue";reason:"approval_required"|"no_compatible_capacity"};

export function planAgentProviderFallback(input:ProviderFallbackInput):ProviderFallbackDecision {
  if(!input.approved)return {mode:"queue",reason:"approval_required"};
  for(const provider of [...new Set(input.preference)]) {
    const status=input[provider];
    if(status.ready&&status.quotaAvailable&&status.concurrencyAvailable) {
      return {mode:"run",provider,slowerLocalFallback:false};
    }
  }
  if(input.taskCanRunLocally&&input.gemma.modelLoaded&&input.gemma.enoughFreeMemory&&
     input.gemma.supportsTask&&input.gemma.concurrencyAvailable) {
    return {mode:"run",provider:"local_gemma",slowerLocalFallback:true};
  }
  return {mode:"queue",reason:"no_compatible_capacity"};
}
