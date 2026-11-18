// Created by NMKato Solutions
// Presentation of native connection observations. This module grants no trust.
export const MESH_CONNECTION_STATES = [
  "idle", "discovering", "listening", "connecting", "connected", "reconnecting", "offline", "blocked",
] as const;
export type MeshConnectionState = typeof MESH_CONNECTION_STATES[number];
export type MeshConnectionRole = "server" | "client";
export interface MeshConnectionSnapshot {
  state: MeshConnectionState;
  role: MeshConnectionRole | null;
  peerFingerprint: string | null;
  lastHeartbeatAt: number | null;
  expiresAt: number | null;
  errorCode: string | null;
  remoteJobsEnabled: false;
}
const FINGERPRINT = /^[0-9A-F]{2}(?:-[0-9A-F]{2}){15}$/;
const HEARTBEAT_FRESH_MS = 20_000;

export function parseMeshConnectionSnapshot(value: unknown): MeshConnectionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (!MESH_CONNECTION_STATES.includes(data.state as MeshConnectionState) ||
      (data.role !== null && data.role !== "server" && data.role !== "client") ||
      (data.peerFingerprint !== null && (typeof data.peerFingerprint !== "string" || !FINGERPRINT.test(data.peerFingerprint))) ||
      (data.errorCode !== null && (typeof data.errorCode !== "string" || !/^[A-Z0-9_]{1,120}$/.test(data.errorCode))) ||
      data.remoteJobsEnabled !== false) return null;
  for (const key of ["lastHeartbeatAt", "expiresAt"] as const) {
    if (data[key] !== null && (!Number.isSafeInteger(data[key]) || (data[key] as number) < 0)) return null;
  }
  if (data.state === "connected" && (data.role === null || data.peerFingerprint === null ||
      data.lastHeartbeatAt === null || data.expiresAt === null ||
      (data.expiresAt as number) <= (data.lastHeartbeatAt as number))) return null;
  return {
    state: data.state as MeshConnectionState,
    role: data.role as MeshConnectionRole | null,
    peerFingerprint: data.peerFingerprint as string | null,
    lastHeartbeatAt: data.lastHeartbeatAt as number | null,
    expiresAt: data.expiresAt as number | null,
    errorCode: data.errorCode as string | null,
    remoteJobsEnabled: false,
  };
}

export function isMeshConnectionLive(snapshot: MeshConnectionSnapshot | null, nowMs: number): boolean {
  return !!snapshot && snapshot.state === "connected" && Number.isFinite(nowMs) &&
    snapshot.lastHeartbeatAt !== null && snapshot.expiresAt !== null &&
    snapshot.lastHeartbeatAt <= nowMs + 5_000 &&
    nowMs - snapshot.lastHeartbeatAt < HEARTBEAT_FRESH_MS && nowMs < snapshot.expiresAt;
}

export function hasMeshConnectionActivity(snapshot: MeshConnectionSnapshot | null): boolean {
  return !!snapshot && ["discovering", "listening", "connecting", "connected", "reconnecting"].includes(snapshot.state);
}

type Registration = { deviceId: string; ownerUserId: string; fingerprint: string; membershipState: string };

/** Preserve a selection only when its exact account and key survive a fresh scan. */
export function retainedMeshSelection(input: {
  selectedId: string | null;
  previous: readonly Registration[];
  next: readonly Registration[];
  ownFingerprint: string | null;
}): string | null {
  const { selectedId, previous, next, ownFingerprint } = input;
  if (!selectedId || !ownFingerprint) return null;
  const before = previous.find(device => device.deviceId === selectedId);
  const after = next.find(device => device.deviceId === selectedId);
  const ownBefore = previous.find(device => device.fingerprint === ownFingerprint);
  const ownAfter = next.find(device => device.fingerprint === ownFingerprint);
  if (!before || !after || !ownBefore || !ownAfter || after.fingerprint === ownFingerprint ||
      after.membershipState === "revoked" || ownAfter.membershipState === "revoked" ||
      !FINGERPRINT.test(after.fingerprint) || after.fingerprint !== before.fingerprint ||
      !after.ownerUserId || after.ownerUserId !== before.ownerUserId ||
      after.ownerUserId !== ownAfter.ownerUserId || ownAfter.ownerUserId !== ownBefore.ownerUserId) return null;
  return after.deviceId;
}

export function meshConnectionRecovery(code: string | null): "network" | "account" | "peer" | "retry" {
  if (code && /NETWORK_UNAVAILABLE|NO_PEER|TAILNET|TAILSCALE|SOURCE_IP|CONNECT_TIMEOUT/.test(code)) return "network";
  if (code && /LOGIN|ACCOUNT|SESSION|AUTH_REQUIRED/.test(code)) return "account";
  if (code && /ADMISSION|PIN|REVOK|ENROLL|CERT/.test(code)) return "peer";
  return "retry";
}
