// Created by NMKato Solutions
// Presence observations never grant device access or remote job permission.
export interface RemoteMcpRelaySnapshot {
  state: "idle" | "connecting" | "connected" | "reconnecting" | "blocked";
  lastHeartbeatAt: number | null;
  expiresAt: number | null;
  errorCode: string | null;
  deviceAccessEnabled: false;
  remoteJobsEnabled: false;
}
export function parseRemoteMcpRelaySnapshot(value: unknown): RemoteMcpRelaySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (!["idle", "connecting", "connected", "reconnecting", "blocked"].includes(data.state as string) ||
      data.deviceAccessEnabled !== false || data.remoteJobsEnabled !== false ||
      (data.errorCode !== null && (typeof data.errorCode !== "string" || !/^[A-Z0-9_]{1,120}$/.test(data.errorCode)))) return null;
  for (const key of ["lastHeartbeatAt", "expiresAt"] as const) {
    if (data[key] !== null && (!Number.isSafeInteger(data[key]) || (data[key] as number) < 0)) return null;
  }
  if (data.state === "connected" && (data.lastHeartbeatAt === null || data.expiresAt === null ||
      (data.expiresAt as number) <= (data.lastHeartbeatAt as number))) return null;
  return { state: data.state as RemoteMcpRelaySnapshot["state"],
    lastHeartbeatAt: data.lastHeartbeatAt as number | null, expiresAt: data.expiresAt as number | null,
    errorCode: data.errorCode as string | null, deviceAccessEnabled: false, remoteJobsEnabled: false };
}
export function isRemoteMcpRelayLive(snapshot: RemoteMcpRelaySnapshot | null, nowMs: number): boolean {
  return !!snapshot && snapshot.state === "connected" && Number.isFinite(nowMs) &&
    snapshot.lastHeartbeatAt !== null && snapshot.expiresAt !== null &&
    snapshot.lastHeartbeatAt <= nowMs && nowMs - snapshot.lastHeartbeatAt < 15_000 && nowMs < snapshot.expiresAt;
}
export function remoteMcpRelayActive(snapshot: RemoteMcpRelaySnapshot | null): boolean {
  return !!snapshot && ["connecting", "connected", "reconnecting"].includes(snapshot.state);
}
