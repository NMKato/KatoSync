// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { isRemoteMcpCurrentDeviceApproved, parseRemoteMcpDeviceSnapshot, parseRemoteMcpPreparedDeviceReview } from "../src/lib/remoteMcpDeviceReview.ts";
const now = 1_800_000_000_000;
const client = { id: "11111111-1111-4111-8111-111111111111", name: "ChatGPT KatoSync" };
const device = { deviceId: "22222222-2222-4222-8222-222222222222", name: "Current Mac",
  fingerprint: "01-02-03-04-05-06-07-08-09-0A-0B-0C-0D-0E-0F-10", membershipState: "discovered",
  consentStatus: null, consentExpiresAt: null, revokeEpoch: null };
const raw = { protocol: "katosync-remote-mcp-device-v1", targetClient: client, grantId: "33333333-3333-4333-8333-333333333333",
  currentDevice: device, revision: "a".repeat(64), canApproveDevice: true,
  requiresMfa: true, deviceAccessEnabled: false, remoteJobsEnabled: false };
test("client approval and an existing registration do not imply individual device consent", () => {
  const snapshot = parseRemoteMcpDeviceSnapshot(raw)!;
  assert.ok(snapshot); assert.equal(isRemoteMcpCurrentDeviceApproved(snapshot, now), false);
  const approved = { ...device, membershipState: "trusted", consentStatus: "approved",
    consentExpiresAt: new Date(now + 90_000).toISOString(), revokeEpoch: 0 };
  const accepted = parseRemoteMcpDeviceSnapshot({ ...raw, currentDevice: approved })!;
  assert.ok(accepted); assert.equal(isRemoteMcpCurrentDeviceApproved(accepted, now), true);
  assert.equal(isRemoteMcpCurrentDeviceApproved(accepted, now + 90_000), false);
  for (const changed of [{ revokeEpoch: null }, { consentExpiresAt: null }, { revokeEpoch: -1 }, { revokeEpoch: 2_147_483_648 }])
    assert.equal(parseRemoteMcpDeviceSnapshot({ ...raw, currentDevice: { ...approved, ...changed } }), null);
  for (const changed of [{ consentStatus: "pending" }, { membershipState: "discovered" }, { consentStatus: "revoked" }]) {
    const pending = parseRemoteMcpDeviceSnapshot({ ...raw, currentDevice: { ...approved, ...changed } });
    assert.equal(isRemoteMcpCurrentDeviceApproved(pending, now), false);
  }
});
test("current-device snapshots preserve native boundaries and discard private fields", () => {
  for (const changed of [{ remoteJobsEnabled: true }, { deviceAccessEnabled: true }, { requiresMfa: false },
    { revision: "revision_1234" }, { currentDevice: { ...device, fingerprint: "unverified" } }])
    assert.equal(parseRemoteMcpDeviceSnapshot({ ...raw, ...changed }), null);
  const parsed = parseRemoteMcpDeviceSnapshot({ ...raw, deviceProofPayload: "private", signature: "private",
    currentDevice: { ...device, signingKeySha256: "private", access_token: "private" } })!;
  assert.ok(parsed); assert.equal("deviceProofPayload" in parsed, false); assert.equal("signature" in parsed, false);
  assert.equal("access_token" in parsed.currentDevice, false); assert.equal("signingKeySha256" in parsed.currentDevice, false);
});
test("device confirmation is bound to the displayed app, fingerprint, target, scope and expiry", () => {
  const consentExpiry = new Date(now + 86_400_000).toISOString();
  const prepared = { protocol: "katosync-remote-mcp-device-review-v1", action: "approve_device",
    reviewId: raw.grantId, targetClient: client, currentDevice: { ...device, consentStatus: "pending", revokeEpoch: 0, consentExpiresAt: consentExpiry },
    allowedTools: ["devices.list", "device.status"], expiresAt: now + 90_000, deviceConsentExpiresAt: consentExpiry };
  const expected = { targetClientId: client.id, deviceId: device.deviceId, fingerprint: device.fingerprint, nowMs: now };
  assert.ok(parseRemoteMcpPreparedDeviceReview(prepared, expected));
  for (const changed of [{ targetClientId: raw.grantId }, { deviceId: raw.grantId }, { fingerprint: "00-00" }, { nowMs: Number.NaN }])
    assert.equal(parseRemoteMcpPreparedDeviceReview(prepared, { ...expected, ...changed }), null);
  for (const changed of [{ action: "approve_client" }, { allowedTools: ["remote.exec", "devices.list"] },
    { allowedTools: ["devices.list", "devices.list"] }, { expiresAt: now }, { expiresAt: now + 300_001 },
    { currentDevice: { ...prepared.currentDevice, revokeEpoch: null } }, { deviceConsentExpiresAt: new Date(now).toISOString() }])
    assert.equal(parseRemoteMcpPreparedDeviceReview({ ...prepared, ...changed }, expected), null);
  const parsed = parseRemoteMcpPreparedDeviceReview({ ...prepared, nonce: "private", deviceProof: { payload: "private", signature: "private" }, authChallengeId: raw.grantId }, expected)!;
  assert.ok(parsed); assert.equal("nonce" in parsed, false); assert.equal("deviceProof" in parsed, false); assert.equal("authChallengeId" in parsed, false);
});
