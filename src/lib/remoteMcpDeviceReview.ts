// Created by NMKato Solutions
// Native-verified current registration only; no caller-selected device or implicit epoch.
import { isRemoteMcpReadOnlyScope, REMOTE_MCP_READ_TOOLS } from "./remoteMcpOwnerReview.ts";
export interface RemoteMcpCurrentDevice {
  deviceId: string; name: string; fingerprint: string;
  membershipState: "discovered" | "pending" | "trusted" | "revoked";
  consentStatus: "pending" | "approved" | "revoked" | null;
  consentExpiresAt: string | null; revokeEpoch: number | null;
}
export interface RemoteMcpDeviceSnapshot {
  protocol: "katosync-remote-mcp-device-v1";
  targetClient: { id: string; name: string }; grantId: string;
  currentDevice: RemoteMcpCurrentDevice; revision: string; canApproveDevice: boolean;
  requiresMfa: true; deviceAccessEnabled: false; remoteJobsEnabled: false;
}
export interface RemoteMcpPreparedDeviceReview {
  protocol: "katosync-remote-mcp-device-review-v1";
  reviewId: string; action: "approve_device";
  targetClient: { id: string; name: string }; currentDevice: RemoteMcpCurrentDevice;
  allowedTools: string[]; expiresAt: number; deviceConsentExpiresAt: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && UUID.test(value) && value !== "00000000-0000-0000-0000-000000000000";
const target = (value: unknown): value is { id: string; name: string } => object(value) && id(value.id) &&
  typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 80;
function device(value: unknown): RemoteMcpCurrentDevice | null {
  if (!object(value) || !id(value.deviceId) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 ||
      typeof value.fingerprint !== "string" || !/^[0-9A-F]{2}(?:-[0-9A-F]{2}){15}$/.test(value.fingerprint) ||
      !["discovered", "pending", "trusted", "revoked"].includes(value.membershipState as string) ||
      ![null, "pending", "approved", "revoked"].includes(value.consentStatus as string | null) ||
      (value.consentExpiresAt !== null && (typeof value.consentExpiresAt !== "string" || !Number.isFinite(Date.parse(value.consentExpiresAt)))) ||
      (value.revokeEpoch !== null && (!Number.isInteger(value.revokeEpoch) || (value.revokeEpoch as number) < 0 || (value.revokeEpoch as number) > 2_147_483_647)) ||
      (value.consentStatus === "approved" && (value.revokeEpoch === null || value.consentExpiresAt === null))) return null;
  return { deviceId: value.deviceId, name: value.name, fingerprint: value.fingerprint,
    membershipState: value.membershipState as RemoteMcpCurrentDevice["membershipState"],
    consentStatus: value.consentStatus as RemoteMcpCurrentDevice["consentStatus"],
    consentExpiresAt: value.consentExpiresAt as string | null, revokeEpoch: value.revokeEpoch as number | null };
}
export function parseRemoteMcpDeviceSnapshot(value: unknown): RemoteMcpDeviceSnapshot | null {
  if (!object(value) || value.protocol !== "katosync-remote-mcp-device-v1" || !target(value.targetClient) || !id(value.grantId) ||
      typeof value.revision !== "string" || !/^[a-f0-9]{64}$/.test(value.revision) || typeof value.canApproveDevice !== "boolean" ||
      value.requiresMfa !== true || value.deviceAccessEnabled !== false || value.remoteJobsEnabled !== false) return null;
  const currentDevice = device(value.currentDevice);
  if (!currentDevice || (value.canApproveDevice && currentDevice.membershipState === "revoked")) return null;
  return { protocol: "katosync-remote-mcp-device-v1", targetClient: { id: value.targetClient.id, name: value.targetClient.name },
    grantId: value.grantId, currentDevice, revision: value.revision, canApproveDevice: value.canApproveDevice,
    requiresMfa: true, deviceAccessEnabled: false, remoteJobsEnabled: false };
}
export function isRemoteMcpCurrentDeviceApproved(snapshot: RemoteMcpDeviceSnapshot | null, nowMs: number): boolean {
  const current = snapshot?.currentDevice;
  return !!current && Number.isFinite(nowMs) && current.membershipState === "trusted" && current.consentStatus === "approved" &&
    current.revokeEpoch !== null && current.consentExpiresAt !== null && Date.parse(current.consentExpiresAt) > nowMs;
}
export function parseRemoteMcpPreparedDeviceReview(value: unknown, expected: {
  targetClientId: string; deviceId: string; fingerprint: string; nowMs: number; allowedTools?: readonly string[];
}): RemoteMcpPreparedDeviceReview | null {
  if (!object(value) || !Number.isFinite(expected.nowMs)) return null;
  const tools = value.allowedTools;
  if (value.protocol !== "katosync-remote-mcp-device-review-v1" || value.action !== "approve_device" ||
      !id(value.reviewId) || !target(value.targetClient) || value.targetClient.id !== expected.targetClientId ||
      !isRemoteMcpReadOnlyScope(tools) || tools.length !== (expected.allowedTools ?? REMOTE_MCP_READ_TOOLS).length ||
      !(expected.allowedTools ?? REMOTE_MCP_READ_TOOLS).every(tool => tools.includes(tool)) ||
      !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= expected.nowMs || (value.expiresAt as number) > expected.nowMs + 300_000 ||
      typeof value.deviceConsentExpiresAt !== "string" || !(Date.parse(value.deviceConsentExpiresAt) > expected.nowMs)) return null;
  const currentDevice = device(value.currentDevice);
  if (!currentDevice || currentDevice.deviceId !== expected.deviceId || currentDevice.fingerprint !== expected.fingerprint ||
      currentDevice.revokeEpoch === null || currentDevice.membershipState === "revoked" ||
      currentDevice.consentExpiresAt !== value.deviceConsentExpiresAt) return null;
  return { protocol: "katosync-remote-mcp-device-review-v1", reviewId: value.reviewId, action: "approve_device",
    targetClient: { id: value.targetClient.id, name: value.targetClient.name }, currentDevice,
    allowedTools: [...tools], expiresAt: value.expiresAt as number,
    deviceConsentExpiresAt: value.deviceConsentExpiresAt };
}
