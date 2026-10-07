// Created by NMKato Solutions
// User-facing presentation truth for Agent Sync lanes. This layer never changes routing/ownership;
// it only turns canonical lane truth into understandable labels and brand hints.
import type { AgentLane } from "../types";

export type AgentLaneBrand = "openai" | "claude" | "kai" | "katosync" | "remote";
/** Brands with an approved local asset in public/. "remote" stays neutral (icon/initials). */
export type AgentBrandAsset = Exclude<AgentLaneBrand, "remote">;

export const AGENT_BRAND_ASSET_SRC: Record<AgentBrandAsset, string> = {
  openai: "/agent-openai.png",
  claude: "/agent-claude.png",
  kai: "/kai-ai-icon.png",
  katosync: "/katoos_icon_logo_trans.png"
};

/** Approved asset for a brand, or null when identity is unknown (neutral fallback). */
export function agentBrandAsset(brand: AgentLaneBrand): AgentBrandAsset | null {
  return brand === "remote" ? null : brand;
}
export type AgentLaneDisplayStatus =
  | "active"
  | "ready"
  | "connected"
  | "waiting"
  | "blocked"
  | "quota_limited"
  | "sign_in_required"
  | "overloaded"
  | "connection_stale"
  | "not_connected"
  | "not_configured"
  | "paused"
  | "offline"
  | "temporarily_unavailable"
  | "unavailable";

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function agentLaneBrand(lane: AgentLane): AgentLaneBrand {
  if (lane.id === "codex") return "openai";
  if (lane.id === "claude") return "claude";
  if (lane.id === "local") return "kai";
  if (lane.id === "local_control") return "katosync";
  // Paid API lanes stay visually distinct from the Codex/Claude subscription lanes, whatever model they run.
  if (lane.id === "api") return "remote";

  const model = normalized(lane.model);
  if (/(claude|anthropic)/.test(model)) return "claude";
  if (/(gpt|openai|chatgpt|codex)/.test(model)) return "openai";
  if (/(gemma|\bkai\b|\brex\b|kato-local-brain)/.test(model)) return "kai";
  return "remote";
}

export function agentLaneDisplayModel(lane: AgentLane): string | null {
  if (lane.id === "local") return lane.model ? "Kai" : null;
  return lane.model ?? null;
}

export function agentLaneDisplayStatus(lane: AgentLane): AgentLaneDisplayStatus {
  if (lane.activity === "active") return "active";
  if (lane.activity === "blocked") return "blocked";

  if (lane.id === "remote_orchestrator") {
    if (lane.connectivity === "connected") return "connected";
    if (lane.connectivity === "limited") return "connection_stale";
    if (lane.connectivity === "disconnected") return "not_connected";
  }

  const reason = normalized(lane.reason);
  if (reason === "quota_limited") return "quota_limited";
  if (reason === "capacity_limited" || reason === "capacity_unavailable") return "overloaded";
  if (
    reason === "sign_in_required" ||
    reason === "auth_unavailable" ||
    reason === "login_required" ||
    reason === "reauth_required"
  ) {
    return "sign_in_required";
  }
  if (reason === "disabled_in_kato_sync") return "paused";
  if (reason === "offline") return "offline";

  if (lane.connectivity === "not_configured") return "not_configured";
  if (lane.connectivity === "disabled") return "paused";
  if (lane.connectivity === "disconnected") return "not_connected";
  if (lane.connectivity === "limited") return "temporarily_unavailable";
  if (lane.activity === "waiting") return "waiting";
  if (lane.connectivity === "connected" && lane.activity === "idle") return "ready";
  return "unavailable";
}

export function splitAgentLaneTitle(label: string): { primary: string; secondary: string | null } {
  const clean = label.trim();
  if (clean.length <= 16) return { primary: clean, secondary: null };

  const withoutTransportSuffix = clean.replace(/\s*\+\s*RDC\s*$/i, "");
  const words = withoutTransportSuffix.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { primary: withoutTransportSuffix, secondary: null };

  return { primary: words[0], secondary: words.slice(1).join(" ") || null };
}
