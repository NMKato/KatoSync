// Created by NMKato Solutions
// Enrollment QR content is transient UI data, never persisted or logged.
export interface RemoteMcpMfaEnrollment { enrollmentId: string; qrCodeDataUrl: string; expiresAt: number }
export function parseRemoteMcpMfaEnrollment(value: unknown, nowMs: number): RemoteMcpMfaEnrollment | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isFinite(nowMs)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.enrollmentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.enrollmentId) ||
      data.enrollmentId === "00000000-0000-0000-0000-000000000000" ||
      typeof data.qrCodeDataUrl !== "string" || data.qrCodeDataUrl.length > 524_288 ||
      !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.qrCodeDataUrl) ||
      !Number.isSafeInteger(data.expiresAt) || (data.expiresAt as number) <= nowMs || (data.expiresAt as number) > nowMs + 300_000) return null;
  return { enrollmentId: data.enrollmentId, qrCodeDataUrl: data.qrCodeDataUrl, expiresAt: data.expiresAt as number };
}
