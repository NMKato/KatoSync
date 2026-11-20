// Created by NMKato Solutions
// Account device presentation. Native authentication and policy remain authoritative.
import { isMeshConnectionLive, meshConnectionRecovery, parseMeshConnectionSnapshot, type MeshConnectionSnapshot } from "./meshConnectionState.ts";
import { meshRegistrationAgentName } from "./meshDirectoryPresentation35.ts";

export type ConnectionMode = "ask" | "automatic";
export interface AccountDevice {
  deviceId: string; ownerUserId: string; displayName: string; personaName: string | null;
  platformOs: "macos" | "windows" | "linux";
  membershipState: "discovered" | "pending" | "trusted" | "revoked";
  fingerprint: string; publicKey: string; lastSeenAt: string | null;
}
export interface AccountNetwork {
  ownerId: string; localDeviceId: string | null; localFingerprint: string | null; localPublicKey: string | null;
  mainDeviceId: string | null; accountRevision: number; mainDeviceAvailable: boolean; accountVerified: true; devices: AccountDevice[];
}
export interface ConnectionProfile {
  peerDeviceId: string; peerFingerprint: string; mode: ConnectionMode; enabled: boolean;
}
export interface AccountConnection extends MeshConnectionSnapshot { peerDeviceId: string }
export interface AccountRuntime {
  ownerId: string; localDeviceId: string | null; mainDeviceId: string | null;
  accountRevision: number; profiles: ConnectionProfile[]; connections: AccountConnection[];
  serverState: "idle" | "listening" | "blocked"; errorCode: string | null; remoteJobsEnabled: false;
}
export interface PairingProof {
  fingerprint: string; comparisonCode: string; paired: false; peerCount: 0; transportReady: false;
}
export const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEVICE_FINGERPRINT = /^[0-9A-F]{2}(?:-[0-9A-F]{2}){15}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && DEVICE_ID.test(v);
const fingerprint = (v: unknown): v is string => typeof v === "string" && DEVICE_FINGERPRINT.test(v);
const publicKey = (v: unknown): v is string => typeof v === "string" && PUBLIC_KEY.test(v);
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

export function parseAccountNetwork(value: unknown): AccountNetwork {
  if (!record(value) || !id(value.ownerId) || !(value.localFingerprint === null || fingerprint(value.localFingerprint)) ||
      !(value.localPublicKey === null || publicKey(value.localPublicKey)) || !revision(value.accountRevision) ||
      value.accountVerified !== true || typeof value.mainDeviceAvailable !== "boolean" ||
      (value.localFingerprint === null) !== (value.localPublicKey === null) ||
      !(value.localDeviceId === null || id(value.localDeviceId)) ||
      !(value.mainDeviceId === null || id(value.mainDeviceId)) ||
      !Array.isArray(value.devices) || value.devices.length > 10) throw Error("MESH_ACCOUNT_INVALID_STATE");
  const seen = new Set<string>(), keys = new Set<string>();
  const devices: AccountDevice[] = value.devices.map(d => {
    if (!record(d) || !id(d.deviceId) || d.ownerUserId !== value.ownerId ||
        typeof d.displayName !== "string" || !d.displayName.trim() || d.displayName.length > 256 ||
        !(d.personaName === null || typeof d.personaName === "string" && d.personaName.length <= 256) ||
        !["macos", "windows", "linux"].includes(String(d.platformOs)) ||
        !["discovered", "pending", "trusted", "revoked"].includes(String(d.membershipState)) ||
        !fingerprint(d.fingerprint) || !publicKey(d.publicKey) ||
        !(d.lastSeenAt === null || typeof d.lastSeenAt === "string" && Number.isFinite(Date.parse(d.lastSeenAt))) ||
        seen.has(d.deviceId) || keys.has(d.fingerprint)) throw Error("MESH_ACCOUNT_INVALID_STATE");
    seen.add(d.deviceId); keys.add(d.fingerprint);
    return d as unknown as AccountDevice;
  });
  const own = devices.find(d => d.deviceId === value.localDeviceId);
  if (value.localDeviceId !== null && (!own || own.fingerprint !== value.localFingerprint ||
      own.publicKey !== value.localPublicKey) ||
      value.localDeviceId === null && devices.some(d => d.fingerprint === value.localFingerprint) ||
      value.mainDeviceId !== null && !seen.has(value.mainDeviceId)) throw Error("MESH_ACCOUNT_INVALID_STATE");
  const main = devices.find(d => d.deviceId === value.mainDeviceId);
  if (value.mainDeviceAvailable && (!main || main.membershipState === "revoked")) throw Error("MESH_ACCOUNT_INVALID_STATE");
  return { ownerId: value.ownerId, localDeviceId: value.localDeviceId, localFingerprint: value.localFingerprint,
    localPublicKey: value.localPublicKey, mainDeviceId: value.mainDeviceId, accountRevision: value.accountRevision,
    mainDeviceAvailable: value.mainDeviceAvailable, accountVerified: true, devices };
}

export function parseAccountRuntime(value: unknown, network: AccountNetwork): AccountRuntime | null {
  if (record(value) && value.ownerId === null && value.localDeviceId === null && value.mainDeviceId === null &&
      value.accountRevision === null && Array.isArray(value.profiles) && value.profiles.length === 0 &&
      Array.isArray(value.connections) && value.connections.length === 0 && value.remoteJobsEnabled === false) return null;
  if (!record(value) || value.ownerId !== network.ownerId || value.localDeviceId !== network.localDeviceId ||
      !(value.mainDeviceId === null || id(value.mainDeviceId)) || !revision(value.accountRevision) ||
      !Array.isArray(value.profiles) || value.profiles.length > 10 ||
      !Array.isArray(value.connections) || value.connections.length > 10 || value.remoteJobsEnabled !== false ||
      !["idle", "listening", "blocked"].includes(String(value.serverState)) ||
      !(value.errorCode === null || typeof value.errorCode === "string" && /^[A-Z0-9_]{1,120}$/.test(value.errorCode)))
    throw Error("MESH_ACCOUNT_INVALID_STATE");
  const seen = new Set<string>();
  const profiles = value.profiles.map(p => {
    if (!record(p) || !id(p.peerDeviceId) || p.peerDeviceId === network.localDeviceId ||
        !fingerprint(p.peerFingerprint) || !["ask", "automatic"].includes(String(p.mode)) ||
        typeof p.enabled !== "boolean" || seen.has(p.peerDeviceId)) throw Error("MESH_ACCOUNT_INVALID_STATE");
    seen.add(p.peerDeviceId);
    return p as unknown as ConnectionProfile;
  });
  seen.clear();
  const connections = value.connections.map(c => {
    if (!record(c) || !id(c.peerDeviceId) || seen.has(c.peerDeviceId)) throw Error("MESH_ACCOUNT_INVALID_STATE");
    const parsed = parseMeshConnectionSnapshot(c);
    if (!parsed) throw Error("MESH_ACCOUNT_INVALID_STATE");
    seen.add(c.peerDeviceId);
    return { ...parsed, peerDeviceId: c.peerDeviceId };
  });
  return { ownerId: value.ownerId as string, localDeviceId: value.localDeviceId as string | null,
    mainDeviceId: value.mainDeviceId as string | null, accountRevision: value.accountRevision, profiles, connections,
    serverState: value.serverState as AccountRuntime["serverState"], errorCode: value.errorCode as string | null, remoteJobsEnabled: false };
}

export function sameDeviceBinding(before: AccountNetwork, after: AccountNetwork, peerId: string): boolean {
  const a = before.devices.find(d => d.deviceId === peerId), b = after.devices.find(d => d.deviceId === peerId);
  return before.ownerId === after.ownerId && before.localDeviceId === after.localDeviceId &&
    before.localFingerprint === after.localFingerprint && before.localPublicKey === after.localPublicKey &&
    before.mainDeviceId === after.mainDeviceId && before.accountRevision === after.accountRevision &&
    !!a && !!b && a.fingerprint === b.fingerprint && a.publicKey === b.publicKey && b.membershipState !== "revoked";
}

export function eligiblePeer(network: AccountNetwork, peerId: string): AccountDevice | null {
  const own = network.devices.find(d => d.deviceId === network.localDeviceId);
  const peer = network.devices.find(d => d.deviceId === peerId);
  if (!own || !["discovered", "trusted"].includes(own.membershipState) || !peer || !["discovered", "trusted"].includes(peer.membershipState) ||
      peer.deviceId === own.deviceId || !network.mainDeviceId || !network.mainDeviceAvailable ||
      own.deviceId !== network.mainDeviceId && peer.deviceId !== network.mainDeviceId) return null;
  return peer;
}

export function deviceConnection(network: AccountNetwork, runtime: AccountRuntime | null, peerId: string): AccountConnection | null {
  const peer = eligiblePeer(network, peerId);
  if (!peer || !runtime || runtime.ownerId !== network.ownerId || runtime.localDeviceId !== network.localDeviceId ||
      runtime.mainDeviceId !== network.mainDeviceId || runtime.accountRevision !== network.accountRevision) return null;
  const state = runtime.connections.find(c => c.peerDeviceId === peerId && c.peerFingerprint === peer.fingerprint);
  const expectedRole = network.localDeviceId === network.mainDeviceId ? "server" : "client";
  return state && (state.role === null || state.role === expectedRole) ? state : null;
}

// Nur diese festen, im nativen Account-/Admission-Vertrag vorhandenen Codes dürfen angezeigt werden.
// Das Literal dient zugleich als begrenzter öffentlicher Vertrag für sichere Diagnose-Leser.
export const ACCOUNT_MESH_PUBLIC_ERROR_CODES = [
  "MESH_ACCOUNT_AUTHORITY_UNAVAILABLE",
  "MESH_ACCOUNT_CONFIRM_CONNECTION_REQUIRED",
  "MESH_ACCOUNT_CONNECTION_NOT_STARTED",
  "MESH_ACCOUNT_DEVICE_NOT_REGISTERED",
  "MESH_ACCOUNT_DEVICE_UNAVAILABLE",
  "MESH_ACCOUNT_IDENTITY_UNAVAILABLE",
  "MESH_ACCOUNT_INVALID_RESPONSE",
  "MESH_ACCOUNT_INVALID_SELECTION",
  "MESH_ACCOUNT_LAN_UNAVAILABLE",
  "MESH_ACCOUNT_LOCAL_DEVICE_UNAVAILABLE",
  "MESH_ACCOUNT_LOCAL_IDENTITY_CHANGED",
  "MESH_ACCOUNT_LOGIN_REQUIRED",
  "MESH_ACCOUNT_MAIN_REQUIRED",
  "MESH_ACCOUNT_MAIN_UNAVAILABLE",
  "MESH_ACCOUNT_MEMBERSHIP_REQUIRED",
  "MESH_ACCOUNT_NETWORK_UNAVAILABLE",
  "MESH_ACCOUNT_NOT_AVAILABLE",
  "MESH_ACCOUNT_NOT_CONFIGURED",
  "MESH_ACCOUNT_OPERATION_CANCELLED",
  "MESH_ACCOUNT_PEER_CHANGED",
  "MESH_ACCOUNT_PEER_REVOKED",
  "MESH_ACCOUNT_PIN_APPROVED_CONNECTION_NOT_STARTED",
  "MESH_ACCOUNT_PROFILE_INVALID",
  "MESH_ACCOUNT_PROFILE_REQUIRED",
  "MESH_ACCOUNT_PROOF_CHANGED",
  "MESH_ACCOUNT_PROOF_EXPIRED",
  "MESH_ACCOUNT_REVIEW_CHANGED",
  "MESH_ACCOUNT_REVIEW_EXPIRED",
  "MESH_ACCOUNT_REVIEW_LIMIT",
  "MESH_ACCOUNT_REVISION_CHANGED",
  "MESH_ACCOUNT_REVISION_CONFLICT",
  "MESH_ACCOUNT_ROLE_FROM_MAIN_ONLY",
  "MESH_ACCOUNT_SELECT_MAIN_DEVICE",
  "MESH_ACCOUNT_SESSION_CHANGED",
  "MESH_ACCOUNT_STATE_UNAVAILABLE",
  "MESH_ACCOUNT_UNAVAILABLE",
  "MESH_ADMISSION_ACCOUNT_CHANGED",
  "MESH_ADMISSION_AUTHORITY_UNAVAILABLE",
  "MESH_ADMISSION_CERTIFICATE_UNAVAILABLE",
  "MESH_ADMISSION_ENROLLMENT_REQUIRED",
  "MESH_ADMISSION_ENROLLMENT_REVOKED",
  "MESH_ADMISSION_LOCAL_IDENTITY_CHANGED",
  "MESH_ADMISSION_LOCAL_IDENTITY_MISSING",
  "MESH_ADMISSION_LOGIN_REQUIRED",
  "MESH_ADMISSION_NOT_CONFIGURED",
  "MESH_ADMISSION_PEER_CHANGED",
  "MESH_ADMISSION_PEER_NOT_APPROVED",
  "MESH_ADMISSION_PEER_REVOKED",
  "MESH_CONNECTION_ADDRESS_DENIED",
  "MESH_CONNECTION_AUTHORITY_TIMEOUT",
  "MESH_CONNECTION_CLOCK_UNAVAILABLE",
  "MESH_CONNECTION_DISCOVERY_LIMIT",
  "MESH_CONNECTION_HEARTBEAT_EXPIRED",
  "MESH_CONNECTION_LISTEN_UNAVAILABLE",
  "MESH_CONNECTION_LOCAL_IDENTITY_UNAVAILABLE",
  "MESH_CONNECTION_NETWORK_UNAVAILABLE",
  "MESH_CONNECTION_NO_PEER",
  "MESH_CONNECTION_PEER_PIN_MISMATCH",
  "MESH_CONNECTION_SEQUENCE_EXHAUSTED",
  "MESH_CONNECTION_STATE_UNAVAILABLE",
  "MESH_CONNECTION_TLS_DENIED",
  "MESH_STAGE4AA_TAILSCALE_PEER_UNVERIFIED",
  "MESH_STAGE4AA_TAILSCALE_UNAVAILABLE",
  "MESH_STAGE4AB2_ACCEPT_DENIED",
  "MESH_STAGE4AB2_ACCEPT_TIMEOUT",
  "MESH_STAGE4AB2_ADMISSION_DENIED",
  "MESH_STAGE4AB2_ADMISSION_REVOKED",
  "MESH_STAGE4AB2_ARGUMENTS_DENIED",
  "MESH_STAGE4AB2_BAD_INIT_ACK",
  "MESH_STAGE4AB2_BAD_INIT_HELLO",
  "MESH_STAGE4AB2_BAD_INIT_NONCE",
  "MESH_STAGE4AB2_BIND_DENIED",
  "MESH_STAGE4AB2_CERT_PIN_DENIED",
  "MESH_STAGE4AB2_CONCURRENT_PROBE_DENIED",
  "MESH_STAGE4AB2_CONNECT_DENIED",
  "MESH_STAGE4AB2_CONNECT_TIMEOUT",
  "MESH_STAGE4AB2_HEARTBEAT_DENIED",
  "MESH_STAGE4AB2_HEARTBEAT_IO",
  "MESH_STAGE4AB2_HEARTBEAT_LEASE_DENIED",
  "MESH_STAGE4AB2_HEARTBEAT_REPLAY_OR_MISMATCH",
  "MESH_STAGE4AB2_HEARTBEAT_TIMEOUT",
  "MESH_STAGE4AB2_INIT_IO",
  "MESH_STAGE4AB2_INIT_TIMEOUT",
  "MESH_STAGE4AB2_LEASE_DENIED",
  "MESH_STAGE4AB2_LEASE_EXPIRED",
  "MESH_STAGE4AB2_LOCAL_TLS_DENIED",
  "MESH_STAGE4AB2_OWNER_DENIED",
  "MESH_STAGE4AB2_OWNER_OR_PIN_REVOKED",
  "MESH_STAGE4AB2_PEER_PIN_DENIED",
  "MESH_STAGE4AB2_PORT_DENIED",
  "MESH_STAGE4AB2_SOCKET_DENIED",
  "MESH_STAGE4AB2_SOURCE_BIND_DENIED",
  "MESH_STAGE4AB2_SOURCE_IP_DENIED",
  "MESH_STAGE4AB2_SOURCE_OR_PEER_IP_DENIED",
  "MESH_STAGE4AB2_TLS_NAME_DENIED",
  "MESH_STAGE4AB2_TLS_REJECTED",
  "MESH_STAGE4AB2_TLS_TIMEOUT",
  "MESH_STAGE4AB32B_CLOCK_OR_SLEEP_GAP_DENIED",
] as const;
export type AccountMeshPublicErrorCode = (typeof ACCOUNT_MESH_PUBLIC_ERROR_CODES)[number];
const RECOVERY_OVERRIDES: Partial<Record<AccountMeshPublicErrorCode, ReturnType<typeof meshConnectionRecovery> | "changed">> = {
  MESH_ACCOUNT_AUTHORITY_UNAVAILABLE: "retry",
  MESH_ACCOUNT_CONFIRM_CONNECTION_REQUIRED: "retry",
  MESH_ACCOUNT_CONNECTION_NOT_STARTED: "retry",
  MESH_ACCOUNT_DEVICE_NOT_REGISTERED: "retry",
  MESH_ACCOUNT_DEVICE_UNAVAILABLE: "retry",
  MESH_ACCOUNT_IDENTITY_UNAVAILABLE: "retry",
  MESH_ACCOUNT_INVALID_RESPONSE: "retry",
  MESH_ACCOUNT_INVALID_SELECTION: "retry",
  MESH_ACCOUNT_LAN_UNAVAILABLE: "network",
  MESH_ACCOUNT_LOCAL_DEVICE_UNAVAILABLE: "retry",
  MESH_ACCOUNT_LOCAL_IDENTITY_CHANGED: "changed",
  MESH_ACCOUNT_MAIN_REQUIRED: "retry",
  MESH_ACCOUNT_MAIN_UNAVAILABLE: "retry",
  MESH_ACCOUNT_NETWORK_UNAVAILABLE: "network",
  MESH_ACCOUNT_NOT_AVAILABLE: "retry",
  MESH_ACCOUNT_NOT_CONFIGURED: "retry",
  MESH_ACCOUNT_OPERATION_CANCELLED: "retry",
  MESH_ACCOUNT_PEER_CHANGED: "changed",
  MESH_ACCOUNT_PEER_REVOKED: "peer",
  MESH_ACCOUNT_PIN_APPROVED_CONNECTION_NOT_STARTED: "retry",
  MESH_ACCOUNT_PROFILE_INVALID: "retry",
  MESH_ACCOUNT_PROFILE_REQUIRED: "retry",
  MESH_ACCOUNT_PROOF_CHANGED: "changed",
  MESH_ACCOUNT_PROOF_EXPIRED: "retry",
  MESH_ACCOUNT_REVIEW_CHANGED: "changed",
  MESH_ACCOUNT_REVIEW_EXPIRED: "retry",
  MESH_ACCOUNT_REVIEW_LIMIT: "retry",
  MESH_ACCOUNT_REVISION_CHANGED: "changed",
  MESH_ACCOUNT_REVISION_CONFLICT: "changed",
  MESH_ACCOUNT_ROLE_FROM_MAIN_ONLY: "retry",
  MESH_ACCOUNT_SELECT_MAIN_DEVICE: "retry",
  MESH_ACCOUNT_STATE_UNAVAILABLE: "retry",
  MESH_ACCOUNT_UNAVAILABLE: "retry",
  MESH_ADMISSION_ACCOUNT_CHANGED: "changed",
  MESH_ADMISSION_AUTHORITY_UNAVAILABLE: "retry",
  MESH_ADMISSION_CERTIFICATE_UNAVAILABLE: "retry",
  MESH_ADMISSION_LOCAL_IDENTITY_CHANGED: "changed",
  MESH_ADMISSION_LOCAL_IDENTITY_MISSING: "retry",
  MESH_ADMISSION_NOT_CONFIGURED: "retry",
  MESH_ADMISSION_PEER_CHANGED: "changed",
  MESH_CONNECTION_ADDRESS_DENIED: "network",
  MESH_CONNECTION_AUTHORITY_TIMEOUT: "retry",
  MESH_CONNECTION_CLOCK_UNAVAILABLE: "retry",
  MESH_CONNECTION_DISCOVERY_LIMIT: "retry",
  MESH_CONNECTION_HEARTBEAT_EXPIRED: "network",
  MESH_CONNECTION_LISTEN_UNAVAILABLE: "network",
  MESH_CONNECTION_LOCAL_IDENTITY_UNAVAILABLE: "retry",
  MESH_CONNECTION_SEQUENCE_EXHAUSTED: "retry",
  MESH_CONNECTION_STATE_UNAVAILABLE: "retry",
  MESH_CONNECTION_TLS_DENIED: "peer",
  MESH_STAGE4AB2_ACCEPT_DENIED: "retry",
  MESH_STAGE4AB2_ACCEPT_TIMEOUT: "network",
  MESH_STAGE4AB2_ARGUMENTS_DENIED: "retry",
  MESH_STAGE4AB2_BAD_INIT_ACK: "peer",
  MESH_STAGE4AB2_BAD_INIT_HELLO: "peer",
  MESH_STAGE4AB2_BAD_INIT_NONCE: "peer",
  MESH_STAGE4AB2_BIND_DENIED: "network",
  MESH_STAGE4AB2_CONCURRENT_PROBE_DENIED: "retry",
  MESH_STAGE4AB2_CONNECT_DENIED: "retry",
  MESH_STAGE4AB2_HEARTBEAT_DENIED: "retry",
  MESH_STAGE4AB2_HEARTBEAT_IO: "network",
  MESH_STAGE4AB2_HEARTBEAT_LEASE_DENIED: "retry",
  MESH_STAGE4AB2_HEARTBEAT_REPLAY_OR_MISMATCH: "peer",
  MESH_STAGE4AB2_HEARTBEAT_TIMEOUT: "network",
  MESH_STAGE4AB2_INIT_IO: "network",
  MESH_STAGE4AB2_INIT_TIMEOUT: "network",
  MESH_STAGE4AB2_LEASE_DENIED: "retry",
  MESH_STAGE4AB2_LEASE_EXPIRED: "retry",
  MESH_STAGE4AB2_LOCAL_TLS_DENIED: "retry",
  MESH_STAGE4AB2_OWNER_DENIED: "peer",
  MESH_STAGE4AB2_PORT_DENIED: "network",
  MESH_STAGE4AB2_SOCKET_DENIED: "network",
  MESH_STAGE4AB2_SOURCE_BIND_DENIED: "network",
  MESH_STAGE4AB2_SOURCE_OR_PEER_IP_DENIED: "network",
  MESH_STAGE4AB2_TLS_NAME_DENIED: "peer",
  MESH_STAGE4AB2_TLS_REJECTED: "peer",
  MESH_STAGE4AB2_TLS_TIMEOUT: "network",
  MESH_STAGE4AB32B_CLOCK_OR_SLEEP_GAP_DENIED: "retry",
};
export interface AccountConnectionRecovery {
  kind: ReturnType<typeof meshConnectionRecovery> | "changed";
  code: AccountMeshPublicErrorCode | null;
}
function connectionRecovery(code: string | null): AccountConnectionRecovery {
  const safe = ACCOUNT_MESH_PUBLIC_ERROR_CODES.find(value => value === code) ?? null;
  return { kind: safe ? RECOVERY_OVERRIDES[safe] ?? meshConnectionRecovery(safe) : "retry", code: safe };
}
export function accountPeerRecovery(network: AccountNetwork, runtime: AccountRuntime | null, peerId: string): AccountConnectionRecovery | null {
  const connection = deviceConnection(network, runtime, peerId);
  return connection?.state === "blocked" ? connectionRecovery(connection.errorCode) : null;
}
export function accountMainRecovery(network: AccountNetwork, runtime: AccountRuntime | null): AccountConnectionRecovery | null {
  // runtime.errorCode kann einen Peerfehler spiegeln. Nur ein ausdrücklich blockierter lokaler Server
  // erhält einen eigenen Hinweis; der globale Code wird niemals einem anderen Gerät zugeordnet.
  if (!runtime || !network.localDeviceId || network.localDeviceId !== network.mainDeviceId ||
      !network.mainDeviceAvailable || runtime.ownerId !== network.ownerId ||
      runtime.localDeviceId !== network.localDeviceId || runtime.mainDeviceId !== network.mainDeviceId ||
      runtime.accountRevision !== network.accountRevision || runtime.serverState !== "blocked") return null;
  return connectionRecovery(runtime.errorCode);
}

export type DevicePresentationState = "connected" | "connecting" | "offline" | "blocked" | "registered" | "approval" | "revoked";
export function devicePresentationState(network: AccountNetwork, runtime: AccountRuntime | null,
  peerId: string, approvedFingerprints: readonly string[], now: number): DevicePresentationState {
  const peer = network.devices.find(d => d.deviceId === peerId);
  if (!peer || peer.membershipState === "revoked") return "revoked";
  const connection = deviceConnection(network, runtime, peerId);
  if (isMeshConnectionLive(connection, now)) return "connected";
  if (connection?.state === "blocked") return "blocked";
  if (connection?.state === "offline" || connection?.state === "connected") return "offline";
  if (connection && ["discovering", "listening", "connecting", "reconnecting"].includes(connection.state)) return "connecting";
  if (peer.deviceId !== network.localDeviceId && !approvedFingerprints.includes(peer.fingerprint)) return "approval";
  return "registered";
}

export function defaultPeer(network: AccountNetwork): string | null {
  if (network.mainDeviceId && eligiblePeer(network, network.mainDeviceId)) return network.mainDeviceId;
  return null; // Main device owners explicitly select a participant.
}

export function deviceName(device: AccountDevice): string {
  const persona = device.personaName?.trim();
  if (persona) return persona;
  const generated = PUBLIC_KEY.test(device.publicKey) &&
    device.displayName === `KatoSync ${device.platformOs} ${device.publicKey.slice(0, 5)}`;
  if (!generated) return device.displayName;
  return meshRegistrationAgentName(device.fingerprint, device.platformOs) || device.displayName;
}
export function meshIssue(error: unknown): "account" | "changed" | "registration" | "expired" | "network" | "busy" | "start" | "retry" {
  const code = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/PIN_APPROVED_CONNECTION_NOT_STARTED/.test(code)) return "start";
  if (/REVISION|CONFLICT|MAIN_CHANGED|STALE|BINDING/.test(code)) return "changed";
  if (/LOGIN|AUTH|SESSION|ACCOUNT_REQUIRED|NOT_MEMBER/.test(code)) return "account";
  if (/QUOTA|RATE_LIMIT|PRO_REQUIRED|ENROLLMENT/.test(code)) return "registration";
  if (/EXPIRED|NO_PENDING_PROOF/.test(code)) return "expired";
  if (/NETWORK|TAILNET|TAILSCALE|CONNECT_TIMEOUT|UNREACHABLE/.test(code)) return "network";
  if (/BUSY|IN_PROGRESS/.test(code)) return "busy";
  return "retry";
}
