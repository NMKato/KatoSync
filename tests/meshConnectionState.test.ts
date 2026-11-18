// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import {
  hasMeshConnectionActivity, isMeshConnectionLive, meshConnectionRecovery,
  parseMeshConnectionSnapshot, retainedMeshSelection,
} from "../src/lib/meshConnectionState.ts";

const now = 1_800_000_000_000;
const ownFingerprint = "11-22-33-44-55-66-77-88-99-AA-BB-CC-DD-EE-FF-00";
const peerFingerprint = "AA-BB-CC-DD-EE-FF-00-11-22-33-44-55-66-77-88-99";
const native = {
  state: "connected" as const, role: "client" as const, peerFingerprint,
  lastHeartbeatAt: now - 2_000, expiresAt: now + 18_000,
  errorCode: null, remoteJobsEnabled: false as const,
};

test("only a fresh native channel heartbeat presents a live connection", () => {
  const snapshot = parseMeshConnectionSnapshot(native);
  assert.ok(snapshot);
  assert.equal(isMeshConnectionLive(snapshot, now), true);
  assert.equal(isMeshConnectionLive(snapshot, now + 17_999), true);
  assert.equal(isMeshConnectionLive(snapshot, now + 18_000), false);
  assert.equal(isMeshConnectionLive({ ...snapshot, expiresAt: now + 120_000 }, now + 18_000), false);
});

test("sleep, clock skew and malformed snapshots cannot leave a green state", () => {
  const snapshot = parseMeshConnectionSnapshot(native)!;
  assert.equal(isMeshConnectionLive(snapshot, now + 60_000), false);
  assert.equal(isMeshConnectionLive(snapshot, now - 7_001), false);
  assert.equal(isMeshConnectionLive(snapshot, Number.NaN), false);
  assert.equal(isMeshConnectionLive(null, now), false);
  for (const changed of [
    { state: "paired" }, { role: "hub" }, { role: null }, { peerFingerprint: null },
    { peerFingerprint: "other-device" }, { lastHeartbeatAt: null }, { expiresAt: null },
    { lastHeartbeatAt: Number.NaN }, { expiresAt: now - 3_000 }, { remoteJobsEnabled: true },
    { errorCode: "raw error with private path" },
  ]) assert.equal(parseMeshConnectionSnapshot({ ...native, ...changed }), null);
  for (const value of [null, [], "connected", {}, { state: "idle" }])
    assert.equal(parseMeshConnectionSnapshot(value), null);
});

test("discovery, waiting, reconnect and saved roles are never presented as connected", () => {
  for (const state of ["idle", "discovering", "listening", "connecting", "reconnecting", "offline", "blocked"] as const) {
    const snapshot = parseMeshConnectionSnapshot({ ...native, state });
    assert.ok(snapshot);
    assert.equal(isMeshConnectionLive(snapshot, now), false, state);
    assert.equal(hasMeshConnectionActivity(snapshot), ["discovering", "listening", "connecting", "reconnecting"].includes(state));
  }
  assert.equal(hasMeshConnectionActivity(null), false);
});

const own = { deviceId: "own", ownerUserId: "owner-a", fingerprint: ownFingerprint, membershipState: "discovered" };
const peer = { deviceId: "peer", ownerUserId: "owner-a", fingerprint: peerFingerprint, membershipState: "discovered" };
const selection = { selectedId: "peer", previous: [own, peer], next: [own, peer], ownFingerprint };

test("fresh account discovery preserves the exact selected peer without new pairing", () => {
  assert.equal(retainedMeshSelection(selection), "peer");
  assert.equal(retainedMeshSelection({ ...selection, next: [peer, own] }), "peer");
  assert.equal(retainedMeshSelection({ ...selection, next: [own, { ...peer, membershipState: "trusted" }] }), "peer");
});

test("account switch, key rotation, revocation and removal clear the old selection", () => {
  for (const next of [
    [own], [peer], [own, { ...peer, membershipState: "revoked" }],
    [{ ...own, membershipState: "revoked" }, peer],
    [own, { ...peer, fingerprint: ownFingerprint }],
    [own, { ...peer, ownerUserId: "owner-b" }],
    [{ ...own, ownerUserId: "owner-b" }, { ...peer, ownerUserId: "owner-b" }],
    [own, { ...peer, fingerprint: "00-11-22-33-44-55-66-77-88-99-AA-BB-CC-DD-EE-FF" }],
  ]) assert.equal(retainedMeshSelection({ ...selection, next }), null);
  assert.equal(retainedMeshSelection({ ...selection, selectedId: "own" }), null);
  assert.equal(retainedMeshSelection({ ...selection, selectedId: null }), null);
  assert.equal(retainedMeshSelection({ ...selection, ownFingerprint: null }), null);
  assert.equal(retainedMeshSelection({ ...selection, previous: [] }), null);
});

test("native route and permission failures have useful bounded recovery categories", () => {
  assert.equal(meshConnectionRecovery("MESH_CONNECTION_NETWORK_UNAVAILABLE"), "network");
  assert.equal(meshConnectionRecovery("MESH_CONNECTION_NO_PEER"), "network");
  assert.equal(meshConnectionRecovery("MESH_STAGE4AA_TAILSCALE_UNAVAILABLE"), "network");
  assert.equal(meshConnectionRecovery("MESH_CONNECTION_LOGIN_REQUIRED"), "account");
  assert.equal(meshConnectionRecovery("MESH_CONNECTION_ADMISSION_DENIED"), "peer");
  assert.equal(meshConnectionRecovery("MESH_CONNECTION_PIN_REVOKED"), "peer");
  assert.equal(meshConnectionRecovery(null), "retry");
});
