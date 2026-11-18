// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { parseRemoteMcpOwnerSnapshot, parseRemoteMcpPreparedReview, remoteMcpOwnerRecovery } from "../src/lib/remoteMcpOwnerReview.ts";
const client = { id: "11111111-1111-4111-8111-111111111111", name: "ChatGPT KatoSync" };
const grant = { id: "22222222-2222-4222-8222-222222222222", status: "pending", expiresAt: "2026-12-01T00:00:00Z" };
const snapshot = { protocol: "katosync-remote-mcp-owner-v1", targetClient: client, clientGrant: grant,
  allowedTools: ["devices.list", "device.status"], canRequestClient: false, canApprove: true, canRevoke: false,
  requiresMfa: true, approvalState: "review_required", revision: "revision_12345678",
  factors: [{ id: "33333333-3333-4333-8333-333333333333", friendlyName: "Authenticator" }],
  deviceAccessEnabled: false, remoteExecutionAllowed: false };

test("owner review requires separate client target, MFA and exact read-only scope", () => {
  assert.ok(parseRemoteMcpOwnerSnapshot(snapshot));
  for (const changed of [
    { allowedTools: ["devices.list", "remote.exec"] }, { allowedTools: ["devices.list", "devices.list"] },
    { requiresMfa: false }, { deviceAccessEnabled: true }, { remoteExecutionAllowed: true },
    { clientGrant: null }, { revision: null }, { factors: [] }, { canRequestClient: true },
    { targetClient: { ...client, id: "actor-is-not-target" } },
    { canRevoke: true },
  ]) assert.equal(parseRemoteMcpOwnerSnapshot({ ...snapshot, ...changed }), null);
});
test("pending-only server permits request display without inventing approval readiness", () => {
  const pending = parseRemoteMcpOwnerSnapshot({ ...snapshot, clientGrant: null,
    canRequestClient: true, canApprove: false, factors: [], revision: null,
    approvalState: "actor_target_mfa_bridge_required" });
  assert.ok(pending); assert.equal(pending.canApprove, false); assert.equal(pending.deviceAccessEnabled, false);
  assert.ok(parseRemoteMcpOwnerSnapshot({ ...snapshot, clientGrant: { ...grant, status: "approved" }, canApprove: false, canRevoke: true }));
});
test("a prepared decision cannot change target, action, scope or bounded expiry", () => {
  const now = 1_800_000_000_000;
  const expected = { action: "approve_client" as const, targetClientId: client.id, nowMs: now };
  const receipt = { protocol: "katosync-remote-mcp-review-v1", reviewId: grant.id,
    action: "approve_client", targetClient: client, allowedTools: ["devices.list", "device.status"], expiresAt: now + 90_000 };
  assert.ok(parseRemoteMcpPreparedReview(receipt, expected));
  for (const changed of [{ action: "revoke_client" }, { targetClient: { ...client, id: grant.id } },
    { allowedTools: ["remote.exec"] }, { expiresAt: now }, { expiresAt: now + 300_001 },
    { expiresAt: Number.NaN }, { reviewId: "server-secret-nonce" }])
    assert.equal(parseRemoteMcpPreparedReview({ ...receipt, ...changed }, expected), null);
});
test("native-only private fields are discarded from public receipts", () => {
  const sanitized = parseRemoteMcpOwnerSnapshot({ ...snapshot, targetClient: { ...client, token: "private" }, access_token: "must-not-propagate", nonce: "private", authChallengeId: grant.id });
  assert.ok(sanitized); assert.equal("access_token" in sanitized, false); assert.equal("nonce" in sanitized, false); assert.equal("token" in sanitized.targetClient, false);
  const receipt = parseRemoteMcpPreparedReview({ protocol: "katosync-remote-mcp-review-v1", reviewId: grant.id,
    action: "approve_client", targetClient: client, allowedTools: ["devices.list", "device.status"],
    expiresAt: 90_000, nonce: "private", authChallengeId: grant.id },
  { action: "approve_client", targetClientId: client.id, nowMs: 1 });
  assert.ok(receipt); assert.equal("nonce" in receipt, false); assert.equal("authChallengeId" in receipt, false);
});
test("safe recovery categories never echo raw server diagnostics or OTP", () => {
  assert.equal(remoteMcpOwnerRecovery("REMOTE_MCP_OWNER_SESSION_CHANGED"), "changed");
  assert.equal(remoteMcpOwnerRecovery("REMOTE_MCP_OWNER_LOGIN_REQUIRED"), "login");
  assert.equal(remoteMcpOwnerRecovery("REMOTE_MCP_OWNER_MFA_REJECTED"), "mfa");
  assert.equal(remoteMcpOwnerRecovery("failure code=123456 token=private"), "unavailable");
});
test("Git status is an explicit reviewed scope and cannot appear during a two-scope approval", () => {
  const allowedTools = ["devices.list", "device.status", "git.status"];
  const parsed = parseRemoteMcpOwnerSnapshot({ ...snapshot, allowedTools });
  assert.deepEqual(parsed?.allowedTools, allowedTools);
  for (const bad of [[...allowedTools, "git.status"], [...allowedTools, "terminal.exec"], ["git.status"]])
    assert.equal(parseRemoteMcpOwnerSnapshot({ ...snapshot, allowedTools: bad }), null);
  const now = 1_800_000_000_000;
  const receipt = { protocol: "katosync-remote-mcp-review-v1", reviewId: grant.id,
    action: "approve_client", targetClient: client, allowedTools, expiresAt: now + 90_000 };
  const expected = { action: "approve_client" as const, targetClientId: client.id, nowMs: now };
  assert.equal(parseRemoteMcpPreparedReview(receipt, expected), null);
  assert.deepEqual(parseRemoteMcpPreparedReview(receipt, { ...expected, allowedTools })?.allowedTools, allowedTools);
  assert.equal(parseRemoteMcpPreparedReview({ ...receipt, allowedTools: ["devices.list", "device.status"] }, { ...expected, allowedTools }), null);
});
