// Created by NMKato Solutions
import { isRemoteMcpProjectId } from "./remoteMcpRelayState.ts";
export interface RemoteMcpTerminalReview {
  protocol: "katosync-remote-mcp-terminal-review-v1"; reviewId: string; operationId: string;
  projectId: string; profileId: "git_version"; command: "git --version"; argumentsSha256: string; expiresAt: number;
}
export interface RemoteMcpTerminalApproval {
  protocol: "katosync-remote-mcp-terminal-approval-v1"; operationId: string;
  projectId: string; profileId: "git_version"; argumentsSha256: string; expiresAt: number;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).length === expected.length && expected.every(k => Object.prototype.hasOwnProperty.call(v, k));
const expiry = (v: unknown, now: number, max: number): v is number =>
  Number.isSafeInteger(now) && now > 0 && Number.isSafeInteger(v) && (v as number) > now && (v as number) <= now + max;
export function parseRemoteMcpTerminalReview(value: unknown, projectId: string, nowMs: number): RemoteMcpTerminalReview | null {
  if (!object(value) || !keys(value, ["protocol","reviewId","operationId","projectId","profileId","command","argumentsSha256","expiresAt"]) ||
      value.protocol !== "katosync-remote-mcp-terminal-review-v1" || !id(value.reviewId) || !id(value.operationId) ||
      !isRemoteMcpProjectId(value.projectId) || value.projectId !== projectId || value.profileId !== "git_version" ||
      value.command !== "git --version" || !digest(value.argumentsSha256) || !expiry(value.expiresAt, nowMs, 300_000)) return null;
  return { protocol: value.protocol, reviewId: value.reviewId, operationId: value.operationId,
    projectId: value.projectId, profileId: value.profileId, command: value.command,
    argumentsSha256: value.argumentsSha256, expiresAt: value.expiresAt };
}
export function parseRemoteMcpTerminalApproval(value: unknown, review: RemoteMcpTerminalReview, nowMs: number): RemoteMcpTerminalApproval | null {
  if (!object(value) || !keys(value, ["protocol","operationId","projectId","profileId","argumentsSha256","expiresAt"]) ||
      value.protocol !== "katosync-remote-mcp-terminal-approval-v1" ||
      value.operationId !== review.operationId || value.projectId !== review.projectId ||
      value.profileId !== "git_version" || value.argumentsSha256 !== review.argumentsSha256 ||
      !expiry(value.expiresAt, nowMs, 60_000)) return null;
  return { protocol: value.protocol, operationId: review.operationId, projectId: review.projectId,
    profileId: "git_version", argumentsSha256: review.argumentsSha256, expiresAt: value.expiresAt };
}
