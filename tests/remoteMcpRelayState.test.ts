// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { isRemoteMcpRelayLive, parseRemoteMcpRelaySnapshot, remoteMcpRelayActive } from "../src/lib/remoteMcpRelayState.ts";
const now = 1_800_000_000_000;
const receipt = { state: "connected", lastHeartbeatAt: now - 1000, expiresAt: now + 14_000,
  errorCode: null, deviceAccessEnabled: false, remoteJobsEnabled: false };
test("only a fresh native ACK presents MCP presence as connected", () => {
  const status = parseRemoteMcpRelaySnapshot(receipt)!;
  assert.ok(status); assert.equal(isRemoteMcpRelayLive(status, now), true);
  assert.equal(isRemoteMcpRelayLive(status, now + 14_000), false);
  assert.equal(isRemoteMcpRelayLive({ ...status, expiresAt: now + 90_000 }, now + 14_000), false);
  assert.equal(isRemoteMcpRelayLive(status, now - 1001), false);
  assert.equal(isRemoteMcpRelayLive(status, Number.NaN), false);
});
test("presence cannot imply device consent or job permission", () => {
  for (const changed of [{ deviceAccessEnabled: true }, { remoteJobsEnabled: true },
    { state: "approved" }, { lastHeartbeatAt: null }, { expiresAt: null },
    { expiresAt: now - 1000 }, { errorCode: "private diagnostic text" }])
    assert.equal(parseRemoteMcpRelaySnapshot({ ...receipt, ...changed }), null);
  const parsed = parseRemoteMcpRelaySnapshot({ ...receipt, access_token: "private" })!;
  assert.equal("access_token" in parsed, false);
});
test("waiting, retries, blocked and stopped states do not display a live ACK", () => {
  for (const state of ["idle", "connecting", "reconnecting", "blocked"] as const) {
    const status = parseRemoteMcpRelaySnapshot({ ...receipt, state })!;
    assert.equal(isRemoteMcpRelayLive(status, now), false);
    assert.equal(remoteMcpRelayActive(status), state === "connecting" || state === "reconnecting");
  }
});
