// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { parseRemoteMcpMfaEnrollment } from "../src/lib/remoteMcpMfaEnrollment.ts";
const now = 1_800_000_000_000;
// Harmless SVG fixture: no account, enrollment secret or QR payload.
const receipt = { enrollmentId: "11111111-1111-4111-8111-111111111111", qrCodeDataUrl: "data:image/svg+xml;base64,PHN2Zy8+", expiresAt: now + 300_000 };
test("enrollment accepts only the native, bounded image-data receipt", () => {
  assert.ok(parseRemoteMcpMfaEnrollment(receipt, now));
  for (const changed of [{ enrollmentId: "secret-not-a-handle" }, { enrollmentId: "00000000-0000-0000-0000-000000000000" },
    { qrCodeDataUrl: "https://external.invalid/qr.svg" }, { qrCodeDataUrl: "data:text/html;base64,PHN2Zy8+" },
    { qrCodeDataUrl: "<svg onload='bad()'/>" }, { qrCodeDataUrl: "data:image/svg+xml;base64," + "A".repeat(524_288) },
    { expiresAt: now }, { expiresAt: now + 300_001 }, { expiresAt: Number.NaN }])
    assert.equal(parseRemoteMcpMfaEnrollment({ ...receipt, ...changed }, now), null);
  assert.equal(parseRemoteMcpMfaEnrollment(receipt, Number.NaN), null);
});
test("enrollment does not carry tokens, manual secrets or auth challenges into public state", () => {
  const parsed = parseRemoteMcpMfaEnrollment({ ...receipt, access_token: "private", refresh_token: "private",
    secret: "private", authChallengeId: "private" }, now)!;
  assert.ok(parsed); assert.deepEqual(Object.keys(parsed).sort(), ["enrollmentId", "expiresAt", "qrCodeDataUrl"]);
});
