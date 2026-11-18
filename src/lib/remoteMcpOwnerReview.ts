// Created by NMKato Solutions
// Public native receipts only. Credentials, server nonces and MFA challenges stay native.
export const REMOTE_MCP_READ_TOOLS = ["devices.list", "device.status"] as const;
export type RemoteMcpDecision = "approve_client" | "revoke_client";
export interface RemoteMcpOwnerSnapshot {
  protocol: "katosync-remote-mcp-owner-v1";
  targetClient: { id: string; name: string };
  clientGrant: { id: string; status: "pending" | "approved"; expiresAt: string } | null;
  allowedTools: string[];
  canRequestClient: boolean;
  canApprove: boolean;
  canRevoke: boolean;
  requiresMfa: true;
  approvalState: string;
  revision: string | null;
  factors: { id: string; friendlyName: string }[];
  deviceAccessEnabled: false;
  remoteExecutionAllowed: false;
}
export interface RemoteMcpPreparedReview {
  protocol: "katosync-remote-mcp-review-v1";
  reviewId: string;
  action: RemoteMcpDecision;
  targetClient: { id: string; name: string };
  allowedTools: string[];
  expiresAt: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const target = (value: unknown): value is { id: string; name: string } => object(value) &&
  typeof value.id === "string" && UUID.test(value.id) && typeof value.name === "string" &&
  value.name.trim().length > 0 && value.name.length <= 80;
export const isRemoteMcpReadOnlyScope = (value: unknown): value is string[] => Array.isArray(value) &&
  value.length >= 2 && value.length <= 4 && new Set(value).size === value.length &&
  REMOTE_MCP_READ_TOOLS.every(tool => value.includes(tool)) &&
  value.every(tool => ["devices.list", "device.status", "git.status", "terminal.run_profile"].includes(tool)) &&
  (!value.includes("terminal.run_profile") || value.includes("git.status"));

export function parseRemoteMcpOwnerSnapshot(value: unknown): RemoteMcpOwnerSnapshot | null {
  if (!object(value) || value.protocol !== "katosync-remote-mcp-owner-v1" || !target(value.targetClient) ||
      !isRemoteMcpReadOnlyScope(value.allowedTools) || value.requiresMfa !== true ||
      value.deviceAccessEnabled !== false || value.remoteExecutionAllowed !== false ||
      ![value.canRequestClient, value.canApprove, value.canRevoke].every(flag => typeof flag === "boolean") ||
      typeof value.approvalState !== "string" || !/^[a-z_]{1,80}$/.test(value.approvalState) ||
      (value.revision !== null && (typeof value.revision !== "string" || !/^[A-Za-z0-9_-]{8,256}$/.test(value.revision))) ||
      !Array.isArray(value.factors) || value.factors.length > 10) return null;
  const factors: RemoteMcpOwnerSnapshot["factors"] = [];
  for (const factor of value.factors) {
    if (!object(factor) || typeof factor.id !== "string" || !UUID.test(factor.id) ||
        typeof factor.friendlyName !== "string" || factor.friendlyName.length > 80 ||
        factors.some(item => item.id === factor.id)) return null;
    factors.push({ id: factor.id, friendlyName: factor.friendlyName });
  }
  let clientGrant: RemoteMcpOwnerSnapshot["clientGrant"] = null;
  if (value.clientGrant !== null) {
    const grant = value.clientGrant;
    if (!object(grant) || typeof grant.id !== "string" || !UUID.test(grant.id) ||
        (grant.status !== "pending" && grant.status !== "approved") ||
        typeof grant.expiresAt !== "string" || !Number.isFinite(Date.parse(grant.expiresAt))) return null;
    clientGrant = { id: grant.id, status: grant.status, expiresAt: grant.expiresAt };
  }
  if ((value.canRequestClient && clientGrant !== null) ||
      (value.canApprove && (clientGrant?.status !== "pending" || !value.revision || !factors.length)) ||
      (value.canRevoke && (clientGrant?.status !== "approved" || !value.revision || !factors.length))) return null;
  return {
    protocol: "katosync-remote-mcp-owner-v1", targetClient: { id: value.targetClient.id, name: value.targetClient.name }, clientGrant,
    allowedTools: [...value.allowedTools], canRequestClient: value.canRequestClient as boolean,
    canApprove: value.canApprove as boolean, canRevoke: value.canRevoke as boolean,
    requiresMfa: true, approvalState: value.approvalState, revision: value.revision as string | null,
    factors, deviceAccessEnabled: false, remoteExecutionAllowed: false,
  };
}

export function parseRemoteMcpPreparedReview(value: unknown, expected: {
  action: RemoteMcpDecision; targetClientId: string; nowMs: number; allowedTools?: readonly string[];
}): RemoteMcpPreparedReview | null {
  if (!object(value) || value.protocol !== "katosync-remote-mcp-review-v1" ||
      typeof value.reviewId !== "string" || !UUID.test(value.reviewId) ||
      value.action !== expected.action || !target(value.targetClient) ||
      value.targetClient.id !== expected.targetClientId || !isRemoteMcpReadOnlyScope(value.allowedTools) ||
      value.allowedTools.length !== (expected.allowedTools ?? REMOTE_MCP_READ_TOOLS).length ||
      !(expected.allowedTools ?? REMOTE_MCP_READ_TOOLS).every(tool => (value.allowedTools as string[]).includes(tool)) ||
      !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= expected.nowMs ||
      (value.expiresAt as number) > expected.nowMs + 5 * 60_000) return null;
  return { protocol: "katosync-remote-mcp-review-v1", reviewId: value.reviewId,
    action: expected.action, targetClient: { id: value.targetClient.id, name: value.targetClient.name },
    allowedTools: [...value.allowedTools], expiresAt: value.expiresAt as number };
}

export function remoteMcpOwnerRecovery(cause: unknown): "login" | "changed" | "mfa" | "unavailable" {
  const code = typeof cause === "string" && /^[A-Z0-9_]{1,120}$/.test(cause) ? cause : "";
  if (/SESSION_CHANGED|OWNER_CHANGED|REVIEW_EXPIRED|REVIEW_CHANGED|CANCELLED/.test(code)) return "changed";
  if (/LOGIN_REQUIRED|AUTH_REQUIRED/.test(code)) return "login";
  if (/MFA_REJECTED|TOTP_REJECTED|MFA_INVALID_CODE/.test(code)) return "mfa";
  return "unavailable";
}
