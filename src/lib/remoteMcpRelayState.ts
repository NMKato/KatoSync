// Created by NMKato Solutions
// Presence observations never grant device access or remote job permission.
export interface RemoteMcpRelaySnapshot {
  state: "idle" | "connecting" | "connected" | "reconnecting" | "blocked";
  lastHeartbeatAt: number | null;
  expiresAt: number | null;
  errorCode: string | null;
  deviceAccessEnabled: false;
  remoteJobsEnabled: false;
  readOnlyGitStatusEnabled: boolean;
  approvedProjectIds: string[];
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
  const gitEnabled = data.readOnlyGitStatusEnabled ?? false;
  const projectIds = data.approvedProjectIds ?? [];
  if (typeof gitEnabled !== "boolean" || !Array.isArray(projectIds) || projectIds.length > 8 ||
      new Set(projectIds).size !== projectIds.length || projectIds.some(id => !isRemoteMcpProjectId(id)) ||
      gitEnabled !== (projectIds.length > 0) || (gitEnabled && data.state !== "connected")) return null;
  return { state: data.state as RemoteMcpRelaySnapshot["state"],
    lastHeartbeatAt: data.lastHeartbeatAt as number | null, expiresAt: data.expiresAt as number | null,
    errorCode: data.errorCode as string | null, deviceAccessEnabled: false, remoteJobsEnabled: false,
    readOnlyGitStatusEnabled: gitEnabled, approvedProjectIds: [...projectIds] };
}
export function isRemoteMcpProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,140}$/.test(value) && value !== "." && value !== "..";
}
export interface RemoteMcpProjectOption { id: string; name: string }
export function parseRemoteMcpProjectOptions(value: unknown): RemoteMcpProjectOption[] | null {
  if (!Array.isArray(value) || value.length > 80) return null;
  const options: RemoteMcpProjectOption[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || !isRemoteMcpProjectId(entry.id) ||
        typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 100 ||
        /[\u0000-\u001f\u007f]/.test(entry.name) || options.some(option => option.id === entry.id)) return null;
    options.push({ id: entry.id, name: entry.name });
  }
  return options;
}
export function isRemoteMcpRelayLive(snapshot: RemoteMcpRelaySnapshot | null, nowMs: number): boolean {
  return !!snapshot && snapshot.state === "connected" && Number.isFinite(nowMs) &&
    snapshot.lastHeartbeatAt !== null && snapshot.expiresAt !== null &&
    snapshot.lastHeartbeatAt <= nowMs && nowMs - snapshot.lastHeartbeatAt < 15_000 && nowMs < snapshot.expiresAt;
}
export function remoteMcpRelayActive(snapshot: RemoteMcpRelaySnapshot | null): boolean {
  return !!snapshot && ["connecting", "connected", "reconnecting"].includes(snapshot.state);
}
